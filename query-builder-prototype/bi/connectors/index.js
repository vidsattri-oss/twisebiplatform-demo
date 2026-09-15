'use strict';

/**
 * Typed connections (spec S1–S4). Every connector lands data in the
 * connection's own SQLite file, so the semantic model, queries and reports
 * need no change:
 * - sqlite: an existing file in connections/;
 * - csv, excel: uploads (POST /ingest/csv, POST /ingest/excel);
 * - rest, googleSheet, sap: pulled through the outbound guard (I9);
 * - sqlServer, postgres: copied through an optional driver (database.js).
 * Non-secret settings are stored as JSON; the secret (token or password) is
 * encrypted with secrets.js (AES-256-GCM) and never returned to clients.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const connections = require('../../connections');
const secrets = require('../../secrets');
const { getDb: getMetaDb } = require('../../db');
const { BiError, badRequest, notFound } = require('../errors');
const { ingestJson, typedCells, sanitizeName } = require('../ingest');
const { csvToRecords } = require('../csv');
const { workbookTables } = require('../xlsx');
const { fetchOutbound, assertAllowedUrl } = require('./outbound');
const database = require('./database');

const TYPES = {
  sqlite: { label: 'SQLite file', kind: 'file' },
  csv: { label: 'CSV file', kind: 'upload' },
  excel: { label: 'Excel workbook', kind: 'upload' },
  rest: { label: 'REST API (JSON)', kind: 'pull' },
  googleSheet: { label: 'Google Sheets / Drive link', kind: 'pull' },
  sap: { label: 'SAP / ERP (OData)', kind: 'pull', system: 'SAP' },
  sqlServer: { label: 'SQL Server / AppMasterDB', kind: 'database', system: 'SQL Server' },
  postgres: { label: 'Cloud database (PostgreSQL)', kind: 'database', system: 'PostgreSQL' },
};

const SCHEMA = {
  type: "TEXT NOT NULL DEFAULT 'sqlite'",
  settings_json: 'TEXT',
  status: 'TEXT',
  last_refresh: 'TEXT',
  last_attempt: 'TEXT',
  last_error: 'TEXT',
  row_count: 'INTEGER',
};

function ensureConnectorSchema(meta = getMetaDb()) {
  const have = new Set(meta.prepare('PRAGMA table_info(connections)').all().map((c) => c.name));
  for (const [name, type] of Object.entries(SCHEMA)) {
    if (have.has(name)) continue;
    try {
      meta.exec(`ALTER TABLE connections ADD COLUMN ${name} ${type}`);
    } catch (e) {
      // Another process (a parallel test file) added it first.
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }
}

// --- Settings ------------------------------------------------------------------

function text(value, label, { required = false, max = 500 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${label} is required.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max) throw badRequest(`${label} must be text of at most ${max} characters.`);
  return value.trim() || undefined;
}

function whole(value, label, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

function tableList(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = (Array.isArray(value) ? value : String(value).split(',')).map((t) => String(t).trim()).filter(Boolean);
  if (list.length > 50) throw badRequest('At most 50 tables can be copied per connection.');
  if (list.some((t) => t.length > 260)) throw badRequest('Table names must be at most 260 characters.');
  return list;
}

/** Validated, non-secret settings for a connection type. Missing optional fields leave the connection in "Needs …". */
function normalizeSettings(type, s = {}) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw badRequest('settings must be an object.');
  const refreshMinutes = whole(s.refreshMinutes, 'Refresh interval (minutes)', 0, 10080, 0);
  switch (type) {
    case 'rest':
      return {
        url: text(s.url, 'URL', { required: true, max: 2000 }),
        recordsPath: text(s.recordsPath, 'Records path', { max: 200 }),
        tableName: text(s.tableName, 'Table name', { max: 60 }) ?? 'api_data',
        refreshMinutes,
      };
    case 'googleSheet':
      return {
        url: text(s.url, 'Link', { required: true, max: 2000 }),
        format: ['csv', 'xlsx', 'json'].includes(s.format) ? s.format : 'csv',
        tableName: text(s.tableName, 'Table name', { max: 60 }) ?? 'sheet',
        refreshMinutes,
      };
    case 'sap':
      return {
        serviceUrl: text(s.serviceUrl, 'OData service URL', { max: 2000 }),
        entitySet: text(s.entitySet, 'Entity set', { max: 200 }),
        user: text(s.user, 'User', { max: 200 }),
        top: whole(s.top, 'Rows to read', 1, 50000, 5000),
        refreshMinutes,
      };
    case 'sqlServer':
    case 'postgres':
      return {
        host: text(s.host, 'Host', { max: 255 }),
        port: whole(s.port, 'Port', 1, 65535, type === 'sqlServer' ? 1433 : 5432),
        database: text(s.database, 'Database', { max: 128 }),
        user: text(s.user, 'User', { max: 128 }),
        tables: tableList(s.tables),
        maxRows: whole(s.maxRows, 'Rows per table', 1, 200000, 50000),
        encrypt: s.encrypt !== false,
        trustServerCertificate: s.trustServerCertificate === true,
        refreshMinutes,
      };
    default:
      return {};
  }
}

/** Fails fast on a URL the outbound guard would refuse, before anything is saved. */
function checkUrls(type, settings) {
  if (type === 'rest') assertAllowedUrl(settings.url);
  if (type === 'googleSheet') assertAllowedUrl(googleDownloadUrl(settings.url, settings.format));
  if (type === 'sap' && settings.serviceUrl) assertAllowedUrl(settings.serviceUrl);
}

function missingSettings(type, s, hasSecret) {
  const missing = [];
  if (type === 'sap') {
    if (!s.serviceUrl) missing.push('OData service URL');
    if (!s.entitySet) missing.push('entity set');
  }
  if (type === 'sqlServer' || type === 'postgres') {
    if (!s.host) missing.push('host');
    if (!s.database) missing.push('database');
    if (!s.user) missing.push('user');
    if (!hasSecret) missing.push('password');
    if (!s.tables?.length) missing.push('tables to copy (schema.table)');
  }
  return missing.length ? `Needs ${TYPES[type].system}: ${missing.join(', ')}.` : null;
}

/** What clients may see about a connection. Never the secret. */
function connectionInfo(row) {
  const type = TYPES[row.type] ? row.type : 'sqlite';
  const { kind, label } = TYPES[type];
  let settings = {};
  try {
    settings = row.settings_json ? JSON.parse(row.settings_json) : {};
  } catch {
    settings = {};
  }
  const hasSecret = Boolean(row.credentials_enc);
  let needs = missingSettings(type, settings, hasSecret);
  let state = 'ready';
  if (needs) state = 'needs-setup';
  else if (row.status === 'needs-driver') {
    state = 'needs-setup';
    needs = row.last_error;
  } else if (row.status === 'refresh-failed') state = 'refresh-failed';
  else if (kind !== 'file' && !row.last_refresh) state = kind === 'upload' ? 'needs-upload' : 'needs-refresh';
  return {
    type,
    typeLabel: label,
    kind,
    settings,
    hasSecret,
    state,
    needs,
    lastRefresh: row.last_refresh ?? null,
    lastError: row.status === 'refresh-failed' ? (row.last_error ?? null) : null,
    rowCount: row.row_count ?? null,
  };
}

function connectionTypes() {
  return Object.entries(TYPES).map(([type, t]) => ({
    type,
    ...t,
    ...(t.kind === 'database' && { driver: database.ADAPTERS[type].driver, driverInstalled: Boolean(database.loadDriver(database.ADAPTERS[type].driver)) }),
  }));
}

function connectionRecord(id) {
  ensureConnectorSchema();
  const row = getMetaDb().prepare('SELECT * FROM connections WHERE id = ?').get(id);
  if (!row) throw notFound(`No connection with id ${id}`);
  return { row, info: connectionInfo(row) };
}

function readSecret(row) {
  if (!row.credentials_enc) return undefined;
  try {
    return secrets.decrypt(row.credentials_enc);
  } catch {
    throw badRequest("The stored secret can't be read — the server's CONNECTION_SECRET_KEY has changed. Enter the secret again.");
  }
}

// --- Create / update -----------------------------------------------------------

function createConnection({ name, type = 'sqlite', fileName, settings, secret } = {}) {
  if (!TYPES[type]) throw badRequest(`Unknown connection type "${type}". Use one of: ${Object.keys(TYPES).join(', ')}.`);
  const cleanName = text(name, 'Connection name', { required: true, max: 100 });
  if (secret !== undefined && secret !== null && (typeof secret !== 'string' || secret.length > 4000)) throw badRequest('The secret must be text of at most 4,000 characters.');
  const meta = getMetaDb();
  ensureConnectorSchema(meta);
  const normalized = normalizeSettings(type, settings ?? {});
  checkUrls(type, normalized);

  let file = fileName;
  if (type === 'sqlite') {
    if (typeof fileName !== 'string') throw badRequest('Pick one of the available files.');
    try {
      connections.getFilePath(0, fileName);
    } catch (e) {
      throw badRequest(e.message);
    }
    if (meta.prepare('SELECT 1 FROM connections WHERE file_name = ?').get(fileName)) throw badRequest(`"${fileName}" is already connected.`);
  } else {
    file = `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}.db`;
    fs.mkdirSync(connections.CONNECTIONS_DIR, { recursive: true });
    new DatabaseSync(path.join(connections.CONNECTIONS_DIR, file)).close();
  }
  const info = meta
    .prepare('INSERT INTO connections (name, file_name, credentials_enc, created_at, type, settings_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(cleanName, file, secret ? secrets.encrypt(secret) : null, new Date().toISOString(), type, JSON.stringify(normalized), 'ready');
  return { id: Number(info.lastInsertRowid) };
}

/** name and settings (merged) change when given; secret: a string replaces it, null removes it, omitted keeps it. */
function updateConnection(id, body = {}) {
  const { row, info } = connectionRecord(id);
  if (row.file_name === connections.ROOT_DB_FILE) throw badRequest('The built-in Operations connection can’t be changed.');
  const name = body.name === undefined ? row.name : text(body.name, 'Connection name', { required: true, max: 100 });
  const settings = body.settings === undefined ? info.settings : normalizeSettings(info.type, { ...info.settings, ...body.settings });
  checkUrls(info.type, settings);
  let credentials = row.credentials_enc;
  if (body.secret === null) credentials = null;
  else if (typeof body.secret === 'string' && body.secret) {
    if (body.secret.length > 4000) throw badRequest('The secret must be text of at most 4,000 characters.');
    credentials = secrets.encrypt(body.secret);
  }
  getMetaDb()
    .prepare("UPDATE connections SET name = ?, settings_json = ?, credentials_enc = ?, status = 'ready', last_error = NULL WHERE id = ?")
    .run(name, JSON.stringify(settings), credentials, id);
  return { id };
}

// --- Pulling -------------------------------------------------------------------

/** Google share and publish links as direct download links: Sheets export CSV / XLSX, Drive files download. */
function googleDownloadUrl(raw, format = 'csv') {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest(`"${raw}" isn't a valid link.`);
  }
  const gid = url.searchParams.get('gid') ?? /gid=(\d+)/.exec(url.hash)?.[1];
  const withGid = (u) => (gid ? `${u}&gid=${encodeURIComponent(gid)}` : u);
  const sheetFormat = format === 'xlsx' ? 'xlsx' : 'csv';
  if (url.hostname === 'docs.google.com') {
    const published = /^\/spreadsheets\/d\/e\/([\w-]+)/.exec(url.pathname);
    if (published) return withGid(`https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=${sheetFormat}`);
    const sheet = /^\/spreadsheets\/d\/([\w-]+)/.exec(url.pathname);
    if (sheet) return withGid(`https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=${sheetFormat}`);
  }
  if (url.hostname === 'drive.google.com') {
    const file = /^\/file\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
    if (file) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file)}`;
  }
  return url.toString();
}

function parseJson(body, where) {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw badRequest(`${where} didn't return JSON.`);
  }
}

/** The records in a JSON response: at recordsPath, or in a common envelope (value, d.results, data, items, results). */
function recordsAt(value, recordsPath) {
  let node = value;
  if (recordsPath) {
    for (const part of recordsPath.split('.')) node = node?.[part];
    if (node === undefined) throw badRequest(`Nothing was found at "${recordsPath}" in the response.`);
  } else if (!Array.isArray(value)) {
    node = value?.value ?? value?.d?.results ?? value?.data ?? value?.items ?? value?.results ?? value;
  }
  if (node && typeof node === 'object') return node;
  throw badRequest('The response has no records. Set the records path, e.g. data.items.');
}

async function pull(row, info, options = {}) {
  const s = info.settings;
  const secret = readSecret(row);
  const guard = { allowList: options.allowList, lookup: options.lookup, fetchImpl: options.fetchImpl };
  if (info.type === 'rest') {
    const res = await fetchOutbound(s.url, { ...guard, headers: { Accept: 'application/json', ...(secret && { Authorization: `Bearer ${secret}` }) } });
    return [{ name: s.tableName, records: recordsAt(parseJson(res.body, new URL(s.url).host), s.recordsPath) }];
  }
  if (info.type === 'sap') {
    const url = `${s.serviceUrl.replace(/\/+$/, '')}/${encodeURIComponent(s.entitySet)}?$format=json&$top=${s.top}`;
    const auth = secret ? { Authorization: `Basic ${Buffer.from(`${s.user ?? ''}:${secret}`).toString('base64')}` } : {};
    const res = await fetchOutbound(url, { ...guard, headers: { Accept: 'application/json', ...auth } });
    return [{ name: s.entitySet, records: recordsAt(parseJson(res.body, new URL(url).host)) }];
  }
  const url = googleDownloadUrl(s.url, s.format);
  const res = await fetchOutbound(url, guard);
  if (/text\/html/i.test(res.contentType)) {
    throw badRequest('Google returned a web page instead of data. Share the file with "Anyone with the link", or publish the sheet to the web.');
  }
  if (s.format === 'xlsx') return workbookTables(res.body).map((t) => ({ name: `${s.tableName}_${t.sheet}`, records: t.records }));
  if (s.format === 'json') return [{ name: s.tableName, records: recordsAt(parseJson(res.body, 'Google')) }];
  return [{ name: s.tableName, records: typedCells(csvRecords(res.body.toString('utf8'))) }];
}

function csvRecords(textValue) {
  try {
    return csvToRecords(textValue);
  } catch (e) {
    throw badRequest(e.message);
  }
}

/** Writes each { name, records } table with mode "replace", so a refresh never duplicates rows. */
function landTables(db, tables, { dryRun = false } = {}) {
  let rows = 0;
  const written = [];
  const empty = [];
  const previews = [];
  for (const t of tables) {
    const list = Array.isArray(t.records) ? t.records : [t.records];
    if (!list.length) {
      empty.push(t.name);
      continue;
    }
    const name = sanitizeName(t.name);
    const result = ingestJson(db, { tableName: name, records: list, mode: 'replace', dryRun, rootName: name });
    rows += result.tables[0]?.rowCount ?? 0;
    written.push(...result.tables.map((x) => x.name));
    previews.push(...result.tables);
  }
  return { rows, tables: written, empty, previews };
}

async function refreshConnection(id, options = {}) {
  const { row, info } = connectionRecord(id);
  if (info.kind === 'file') throw badRequest('A SQLite file connection reads the file directly; there is nothing to refresh.');
  if (info.kind === 'upload') throw badRequest(`Upload a new ${info.type === 'csv' ? 'CSV file' : 'workbook'} to refresh this connection.`);
  if (missingSettings(info.type, info.settings, info.hasSecret)) throw badRequest(missingSettings(info.type, info.settings, info.hasSecret));
  const meta = getMetaDb();
  meta.prepare('UPDATE connections SET last_attempt = ? WHERE id = ?').run(new Date().toISOString(), id);
  try {
    const tables = info.kind === 'database'
      ? await database.snapshotDatabase(info.type, { ...info.settings, password: readSecret(row) }, info.settings.tables, { drivers: options.drivers, maxRows: info.settings.maxRows })
      : await pull(row, info, options);
    const landed = landTables(options.db ?? connections.getDb(row.id, row.file_name), tables);
    const refreshedAt = new Date().toISOString();
    meta.prepare("UPDATE connections SET status = 'ready', last_refresh = ?, last_error = NULL, row_count = ? WHERE id = ?").run(refreshedAt, landed.rows, id);
    return { ok: true, rows: landed.rows, tables: landed.tables, empty: landed.empty, refreshedAt };
  } catch (e) {
    const known = e instanceof BiError;
    if (!known) console.error(e);
    const message = known ? e.message : 'The refresh failed; the server log has the details.';
    meta.prepare('UPDATE connections SET status = ?, last_error = ? WHERE id = ?').run(e.needs ? 'needs-driver' : 'refresh-failed', message, id);
    throw known ? e : badRequest(message);
  }
}

async function testConnection(id, options = {}) {
  const { row, info } = connectionRecord(id);
  const missing = missingSettings(info.type, info.settings, info.hasSecret);
  if (missing) return { ok: false, needs: missing, message: missing };
  try {
    if (info.kind === 'file' || info.kind === 'upload') {
      connections.getFilePath(row.id, row.file_name);
      return { ok: true, message: 'The file is available.' };
    }
    if (info.kind === 'database') {
      const result = await database.testDatabase(info.type, { ...info.settings, password: readSecret(row) }, options.drivers);
      if (row.status === 'needs-driver') getMetaDb().prepare("UPDATE connections SET status = 'ready', last_error = NULL WHERE id = ?").run(id);
      return result;
    }
    const tables = await pull(row, info, options);
    const count = tables.reduce((n, t) => n + (Array.isArray(t.records) ? t.records.length : 1), 0);
    return { ok: true, message: `Reached the source: ${count.toLocaleString('en-US')} record(s) in ${tables.length} table(s). Nothing was written.` };
  } catch (e) {
    if (!(e instanceof BiError)) {
      console.error(e);
      return { ok: false, message: 'The test failed; the server log has the details.' };
    }
    if (e.needs) getMetaDb().prepare("UPDATE connections SET status = 'needs-driver', last_error = ? WHERE id = ?").run(e.message, id);
    return { ok: false, message: e.message, ...(e.needs && { needs: e.message }) };
  }
}

// --- Uploads (S2) ----------------------------------------------------------------

const UPLOAD_DEFAULTS = { csv: { file: 'uploads-csv.db', name: 'CSV uploads' }, excel: { file: 'uploads-excel.db', name: 'Excel uploads' } };

/** The connection an upload goes into: the one named, or the default "CSV uploads" / "Excel uploads" connection. */
function uploadTarget(connectionId, type) {
  const meta = getMetaDb();
  ensureConnectorSchema(meta);
  let row;
  if (connectionId === undefined || connectionId === null) {
    const d = UPLOAD_DEFAULTS[type];
    row = meta.prepare('SELECT * FROM connections WHERE file_name = ?').get(d.file);
    if (!row) {
      fs.mkdirSync(connections.CONNECTIONS_DIR, { recursive: true });
      const file = path.join(connections.CONNECTIONS_DIR, d.file);
      if (!fs.existsSync(file)) new DatabaseSync(file).close();
      meta.prepare('INSERT INTO connections (name, file_name, created_at, type, settings_json, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(d.name, d.file, new Date().toISOString(), type, '{}', 'ready');
      row = meta.prepare('SELECT * FROM connections WHERE file_name = ?').get(d.file);
    }
  } else {
    if (!Number.isInteger(connectionId)) throw badRequest('connectionId must be a connection id.');
    row = meta.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId);
    if (!row) throw notFound(`No connection with id ${connectionId}`);
  }
  if (row.file_name === connections.ROOT_DB_FILE) throw badRequest('Files can’t be loaded into the app metadata database; choose another connection.');
  const kind = TYPES[row.type ?? 'sqlite']?.kind ?? 'file';
  if (kind === 'pull' || kind === 'database') throw badRequest('This connection is refreshed from its source, which would overwrite an upload. Upload into a CSV, Excel or SQLite connection.');
  return { row, db: connections.getDb(row.id, row.file_name) };
}

function markUploaded(id, rows) {
  getMetaDb().prepare("UPDATE connections SET status = 'ready', last_refresh = ?, last_error = NULL, row_count = ? WHERE id = ?").run(new Date().toISOString(), rows, id);
}

function uploadCsv({ connectionId, tableName, csv, mode = 'replace', dryRun = false } = {}) {
  if (typeof csv !== 'string' || !csv.trim()) throw badRequest('Send the CSV text.');
  const records = typedCells(csvRecords(csv));
  if (!records.length) throw badRequest('The CSV has no data rows under its header row.');
  const { row, db } = uploadTarget(connectionId, 'csv');
  const name = sanitizeName(tableName ?? 'csv_upload');
  const result = ingestJson(db, { tableName: name, records, mode, dryRun: dryRun === true, rootName: name });
  if (!result.written) return { connectionId: row.id, ...result };
  markUploaded(row.id, result.tables[0].rowCount);
  return { connectionId: row.id, ...result };
}

function uploadExcel({ connectionId, fileName, fileBase64, sheets, mode = 'replace', dryRun = false } = {}) {
  if (typeof fileBase64 !== 'string' || !fileBase64) throw badRequest('Send the workbook as base64 text.');
  if (sheets !== undefined && (!Array.isArray(sheets) || !sheets.every((s) => typeof s === 'string'))) throw badRequest('sheets must be a list of sheet names.');
  const all = workbookTables(Buffer.from(fileBase64, 'base64'));
  const chosen = all.filter((t) => !sheets?.length || sheets.includes(t.sheet));
  const { row, db } = uploadTarget(connectionId, 'excel');
  const base = sanitizeName(String(fileName ?? 'workbook').replace(/\.[^.]+$/, ''));
  const withRows = chosen.filter((t) => t.records.length);
  const emptySheets = chosen.filter((t) => !t.records.length).map((t) => t.sheet);
  if (!withRows.length) throw badRequest(chosen.length ? 'The chosen sheets have no data rows under a header row.' : 'None of the chosen sheets are in the workbook.');
  const importSheet = (t, dry) => {
    const name = sanitizeName(`${base}_${t.sheet}`);
    return ingestJson(db, { tableName: name, records: t.records, mode, dryRun: dry, rootName: name }).tables;
  };
  // Check every sheet before writing any, so a bad sheet never leaves the workbook half loaded.
  const previews = withRows.flatMap((t) => importSheet(t, true));
  const tables = dryRun === true ? previews : withRows.flatMap((t) => importSheet(t, false));
  if (dryRun !== true) markUploaded(row.id, tables.filter((t) => !t.parent).reduce((n, t) => n + t.rowCount, 0));
  return { connectionId: row.id, written: dryRun !== true, tables, sheets: all.map((t) => t.sheet), emptySheets };
}

// --- Scheduled refresh (S3) -----------------------------------------------------

let schedulerTimer = null;

/** Refreshes pull and database connections whose refreshMinutes interval has passed. Started by server.js only. */
function startRefreshScheduler({ intervalMs = 60000 } = {}) {
  if (schedulerTimer) return schedulerTimer;
  const running = new Set();
  schedulerTimer = setInterval(() => {
    ensureConnectorSchema();
    const rows = getMetaDb().prepare("SELECT id, settings_json, last_attempt FROM connections WHERE type IN ('rest', 'googleSheet', 'sap', 'sqlServer', 'postgres')").all();
    for (const r of rows) {
      let minutes = 0;
      try {
        minutes = JSON.parse(r.settings_json || '{}').refreshMinutes ?? 0;
      } catch {
        minutes = 0;
      }
      const due = minutes > 0 && (!r.last_attempt || Date.now() - Date.parse(r.last_attempt) >= minutes * 60000);
      if (!due || running.has(r.id)) continue;
      running.add(r.id);
      refreshConnection(r.id).catch(() => {}).finally(() => running.delete(r.id));
    }
  }, intervalMs);
  schedulerTimer.unref();
  return schedulerTimer;
}

/** A small FLAF / PO / PEG / SCR / MOC feed served by this backend, for trying the REST connector locally. */
function sampleWorkOrders() {
  const types = ['FLAF', 'PO', 'PEG', 'SCR', 'MOC'];
  const plants = ['Marmul ODC', 'Nimr ODC', 'Fahud Station'];
  return Array.from({ length: 30 }, (_, i) => ({
    order_no: `${types[i % 5]}-${4000 + i}`,
    doc_type: types[i % 5],
    plant: plants[i % 3],
    status: ['Open', 'In review', 'Closed'][(i * 7) % 3],
    raised_on: `2026-09-${String(1 + (i % 14)).padStart(2, '0')}`,
    amount: ((i * 37) % 90) * 100 + 500,
    approvals: [{ role: 'Supervisor', approved: i % 4 !== 0 }, ...(i % 3 === 0 ? [{ role: 'QA', approved: i % 2 === 0 }] : [])],
  }));
}

module.exports = {
  TYPES,
  ensureConnectorSchema,
  normalizeSettings,
  connectionInfo,
  connectionTypes,
  createConnection,
  updateConnection,
  googleDownloadUrl,
  recordsAt,
  landTables,
  refreshConnection,
  testConnection,
  uploadCsv,
  uploadExcel,
  startRefreshScheduler,
  sampleWorkOrders,
};

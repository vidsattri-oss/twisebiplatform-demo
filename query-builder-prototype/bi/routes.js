'use strict';

/** Express router for docs/api/bi-contract.openapi.yaml, mounted at /api/bi. */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const connections = require('../connections');
const { getDb: getMetaDb } = require('../db');
const { listModels, loadModel, openModel, findTable, findColumn, quoteIdent, ensureMetaSchema } = require('./model');
const { validateExpression } = require('./dax');
const { runQuery, runRows, runValues } = require('./query');
const { ingestJson, flattenJsonColumn } = require('./ingest');
const reports = require('./reports');
const connectors = require('./connectors');
const plugins = require('./plugins');
const { badRequest, notFound } = require('./errors');

const IMPORTS_FILE = 'json-imports.db';
const PREVIEW = '__preview__';
const router = express.Router();
const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    next(e);
  }
};
const wrapAsync = (fn) => (req, res, next) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((out) => {
      if (out !== undefined) res.json(out);
    }, next);
};
const intParam = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${name} must be a whole number.`);
  return n;
};
const modelIdOf = (body) => {
  if (!body || !Number.isInteger(body.modelId)) throw badRequest('modelId must be a model id.');
  return body.modelId;
};

const expressionKind = (kind) => {
  if (kind === undefined || kind === 'measure') return 'measure';
  if (kind === 'column') return 'column';
  throw badRequest('kind must be "measure" or "column".');
};
const draftName = (name) => (typeof name === 'string' && name.trim() ? name.trim() : undefined);

/** The model with an unsaved measure or calculated column added, so self-references and type checks can see it. */
function withDraft(model, kind, { table, name, expression, dataType }) {
  if (!name) return model;
  if (kind === 'measure') return { ...model, measures: [...model.measures.filter((m) => m.name !== name), { name, table, expression }] };
  return {
    ...model,
    tables: model.tables.map((t) => (t.name === table ? { ...t, columns: [...t.columns.filter((c) => c.name !== name), { name, dataType: dataType || 'text', expression }] } : t)),
  };
}

/** The default target for JSON imports — a separate file, never the metadata database. */
function ensureImportsConnection() {
  const meta = getMetaDb();
  const existing = meta.prepare('SELECT id FROM connections WHERE file_name = ?').get(IMPORTS_FILE);
  if (existing) return existing.id;
  fs.mkdirSync(connections.CONNECTIONS_DIR, { recursive: true });
  const file = path.join(connections.CONNECTIONS_DIR, IMPORTS_FILE);
  if (!fs.existsSync(file)) new DatabaseSync(file).close();
  return Number(meta.prepare('INSERT INTO connections (name, file_name, created_at) VALUES (?, ?, ?)')
    .run('JSON imports', IMPORTS_FILE, new Date().toISOString()).lastInsertRowid);
}

// --- Models & measures ---------------------------------------------------------

router.get('/models', wrap(() => listModels()));
router.get('/models/:modelId', wrap((req) => loadModel(intParam(req.params.modelId, 'modelId'))));

router.post('/models/:modelId/measures', wrap((req) => {
  const modelId = intParam(req.params.modelId, 'modelId');
  const { table, expression, format } = req.body || {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 100 || /[[\]]/.test(name)) throw badRequest('A measure name needs 1 to 100 characters and no square brackets.');
  const model = loadModel(modelId);
  findTable(model, table);
  if (model.measures.some((m) => m.name === name)) throw badRequest(`A measure named [${name}] already exists.`);
  if (model.tables.some((t) => t.columns.some((c) => c.name === name))) throw badRequest(`[${name}] is already a column name; choose another measure name.`);
  const check = validateExpression({ ...model, measures: [...model.measures, { name, table, expression }] }, table, expression);
  if (!check.ok) throw badRequest(check.error.error, check.error.position);
  if (format !== undefined && (typeof format !== 'string' || format.length > 40)) throw badRequest('format must be text of at most 40 characters.');
  const info = getMetaDb().prepare('INSERT INTO bi_measures (model_id, table_name, name, expression, format, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(modelId, table, name, expression, format ?? null, new Date().toISOString());
  return { id: Number(info.lastInsertRowid), name, table, expression, format, origin: 'user' };
}));

router.delete('/models/:modelId/measures/:measureId', wrap((req) => {
  getMetaDb().prepare('DELETE FROM bi_measures WHERE id = ? AND model_id = ?')
    .run(intParam(req.params.measureId, 'measureId'), intParam(req.params.modelId, 'modelId'));
  return { ok: true };
}));

// --- Dataset (data-source level) filters ----------------------------------------

router.get('/models/:modelId/dataset-filters', wrap((req) => loadModel(intParam(req.params.modelId, 'modelId'), { counts: false }).datasetFilters));

router.put('/models/:modelId/dataset-filters', wrap((req) => {
  const modelId = intParam(req.params.modelId, 'modelId');
  const filters = req.body?.filters;
  if (!Array.isArray(filters) || filters.length > 50) throw badRequest('filters must be an array of at most 50 filters.');
  const { model, db } = openModel(modelId);
  reports.validateFilters(model, filters, 'Dataset');
  // Compile each filter against its own table so a bad value is rejected here, not in every report later.
  for (const f of filters) runRows({ ...model, datasetFilters: [] }, db, { table: f.target.table, filters: [f], limit: 1 });
  getMetaDb()
    .prepare('INSERT INTO bi_dataset_filters (model_id, filters_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(model_id) DO UPDATE SET filters_json = excluded.filters_json, updated_at = excluded.updated_at')
    .run(modelId, JSON.stringify(filters), new Date().toISOString());
  return filters;
}));

router.post('/measures/validate', wrap((req) => {
  const model = loadModel(modelIdOf(req.body), { counts: false });
  const { table, expression } = req.body;
  findTable(model, table);
  const kind = expressionKind(req.body.kind);
  const name = draftName(req.body.name);
  return validateExpression(withDraft(model, kind, { table, name, expression }), table, expression, kind, name);
}));

/** F6: what a formula returns — a measure's value over the whole table, or a calculated column's first rows. */
router.post('/measures/preview', wrap((req) => {
  const { model, db } = openModel(modelIdOf(req.body));
  const { table, expression } = req.body;
  findTable(model, table);
  const kind = expressionKind(req.body.kind);
  const check = validateExpression(model, table, expression, kind);
  if (!check.ok) throw badRequest(check.error.error, check.error.position);
  if (kind === 'measure') {
    const result = runQuery(withDraft(model, 'measure', { table, name: PREVIEW, expression }), db, { groupBy: [], measures: [PREVIEW], filters: [] });
    return { dataType: result.columns[0].dataType, value: result.rows[0]?.values[0] ?? null };
  }
  const shown = findTable(model, table).columns.filter((c) => !c.hidden && !c.expression).slice(0, 2);
  const draft = withDraft(model, 'column', { table, name: PREVIEW, expression, dataType: check.dataType });
  const rows = runRows(draft, db, { table, columns: [...shown.map((c) => ({ table, column: c.name })), { table, column: PREVIEW }], filters: [], limit: 5 });
  return { dataType: check.dataType, sample: { columns: rows.columns.map((c) => (c.name === PREVIEW ? 'Result' : c.name)), rows: rows.rows } };
}));

// --- Calculated columns (F5) ----------------------------------------------------

router.post('/models/:modelId/columns', wrap((req) => {
  const modelId = intParam(req.params.modelId, 'modelId');
  const { table, expression, format } = req.body || {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 100 || /[[\]]/.test(name)) throw badRequest('A column name needs 1 to 100 characters and no square brackets.');
  const model = loadModel(modelId, { counts: false });
  const home = findTable(model, table);
  if (home.columns.some((c) => c.name === name)) throw badRequest(`"${table}" already has a column named [${name}].`);
  if (model.measures.some((m) => m.name === name)) throw badRequest(`[${name}] is already a measure name; choose another column name.`);
  if (format !== undefined && format !== null && (typeof format !== 'string' || format.length > 40)) throw badRequest('format must be text of at most 40 characters.');
  const check = validateExpression(withDraft(model, 'column', { table, name, expression }), table, expression, 'column', name);
  if (!check.ok) throw badRequest(check.error.error, check.error.position);
  const info = getMetaDb()
    .prepare('INSERT INTO bi_columns (model_id, table_name, name, expression, format, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(modelId, table, name, expression, format || null, new Date().toISOString());
  return { id: Number(info.lastInsertRowid), name, table, expression, format: format || undefined, dataType: check.dataType, origin: 'user' };
}));

router.delete('/models/:modelId/columns/:columnId', wrap((req) => {
  getMetaDb().prepare('DELETE FROM bi_columns WHERE id = ? AND model_id = ?')
    .run(intParam(req.params.columnId, 'columnId'), intParam(req.params.modelId, 'modelId'));
  return { ok: true };
}));

// --- Queries -------------------------------------------------------------------

router.post('/query', wrap((req) => {
  const { model, db } = openModel(modelIdOf(req.body));
  return runQuery(model, db, req.body);
}));
router.post('/rows', wrap((req) => {
  const { model, db } = openModel(modelIdOf(req.body));
  return runRows(model, db, req.body);
}));
router.post('/values', wrap((req) => {
  const { model, db } = openModel(modelIdOf(req.body));
  return runValues(model, db, req.body);
}));

// --- Reports -------------------------------------------------------------------

router.get('/reports', wrap(() => reports.listReports()));
// R2: categories, and report metadata changes that don't resend the definition.
router.get('/report-categories', wrap(() => reports.listCategories()));
router.put('/report-categories', wrap((req) => reports.saveCategories(req.body?.categories)));
router.patch('/reports/:reportId', wrap((req) => reports.patchReport(intParam(req.params.reportId, 'reportId'), req.body || {})));
router.post('/reports/:reportId/duplicate', wrap((req) => reports.duplicateReport(intParam(req.params.reportId, 'reportId'))));
router.post('/reports', wrap((req) => reports.createReport(req.body)));
router.get('/reports/:reportId', wrap((req) => reports.getReport(intParam(req.params.reportId, 'reportId'))));
router.put('/reports/:reportId', wrap((req) => reports.updateReport(intParam(req.params.reportId, 'reportId'), req.body)));
router.delete('/reports/:reportId', wrap((req) => {
  reports.deleteReport(intParam(req.params.reportId, 'reportId'));
  return { ok: true };
}));

// --- Connections ---------------------------------------------------------------

router.get('/connections', wrap(() => listModels()));
router.get('/connections/available-files', wrap(() => {
  const registered = getMetaDb().prepare('SELECT file_name FROM connections').all().map((r) => r.file_name);
  return connections.listAvailableFiles(registered);
}));
// S1–S4: typed connections. POST accepts { name, type, fileName (sqlite), settings, secret }.
router.get('/connections/types', wrap(() => connectors.connectionTypes()));
router.post('/connections', wrap((req) => connectors.createConnection(req.body || {})));
router.put('/connections/:connectionId', wrap((req) => connectors.updateConnection(intParam(req.params.connectionId, 'connectionId'), req.body || {})));
router.post('/connections/:connectionId/test', wrapAsync((req) => connectors.testConnection(intParam(req.params.connectionId, 'connectionId'))));
router.post('/connections/:connectionId/refresh', wrapAsync((req) => connectors.refreshConnection(intParam(req.params.connectionId, 'connectionId'))));

/** A sample REST feed (FLAF / PO / PEG / SCR / MOC) for trying the REST connector against this server. */
router.get('/samples/work-orders.json', wrap(() => connectors.sampleWorkOrders()));
router.delete('/connections/:connectionId', wrap((req) => {
  const id = intParam(req.params.connectionId, 'connectionId');
  const row = getMetaDb().prepare('SELECT file_name FROM connections WHERE id = ?').get(id);
  if (!row) throw notFound(`No connection with id ${id}`);
  if (row.file_name === connections.ROOT_DB_FILE) throw badRequest('The built-in Operations connection holds app metadata and cannot be removed.');
  getMetaDb().prepare('DELETE FROM connections WHERE id = ?').run(id);
  return { ok: true };
}));

// --- Ingestion -----------------------------------------------------------------

router.post('/ingest/json', wrap((req) => {
  const body = req.body || {};
  const connectionId = body.connectionId === undefined ? ensureImportsConnection() : intParam(body.connectionId, 'connectionId');
  const row = getMetaDb().prepare('SELECT id, file_name FROM connections WHERE id = ?').get(connectionId);
  if (!row) throw notFound(`No connection with id ${connectionId}`);
  if (row.file_name === connections.ROOT_DB_FILE) throw badRequest('JSON can’t be imported into the app metadata database; choose another connection.');
  const result = ingestJson(connections.getDb(row.id, row.file_name), body);
  return { connectionId: row.id, ...result };
}));

// S2: file uploads, sent as JSON (CSV text, or the workbook as base64).
router.post('/ingest/csv', wrap((req) => connectors.uploadCsv(req.body || {})));
router.post('/ingest/excel', wrap((req) => connectors.uploadExcel(req.body || {})));

const MAX_FLATTEN_ROWS = 50000;

/** J1: flatten a JSON text column of a connected table into linked tables in the same database. */
router.post('/ingest/json-column', wrap((req) => {
  const body = req.body || {};
  const connectionId = intParam(body.connectionId, 'connectionId');
  const row = getMetaDb().prepare('SELECT id, file_name FROM connections WHERE id = ?').get(connectionId);
  if (!row) throw notFound(`No connection with id ${connectionId}`);
  if (row.file_name === connections.ROOT_DB_FILE) throw badRequest('JSON columns in the app metadata database can’t be flattened; choose another connection.');
  const model = loadModel(connectionId, { counts: false });
  const table = findTable(model, body.table);
  const jsonColumn = findColumn(model, { table: table.name, column: body.column });
  const keyColumn = findColumn(model, { table: table.name, column: body.keyColumn });
  if (jsonColumn.expression || keyColumn.expression) throw badRequest('Choose stored columns; calculated columns can’t be flattened.');
  if (jsonColumn.name === keyColumn.name) throw badRequest('The key column identifies each row; choose a different column from the JSON column.');

  const db = connections.getDb(row.id, row.file_name);
  const sql = `SELECT ${quoteIdent(keyColumn.name)} AS k, ${quoteIdent(jsonColumn.name)} AS j FROM ${quoteIdent(table.name)} LIMIT ${MAX_FLATTEN_ROWS + 1}`;
  const rows = db.prepare(sql).all().map((r) => ({ key: r.k, json: r.j }));
  if (rows.length > MAX_FLATTEN_ROWS) throw badRequest(`"${table.name}" has more than ${MAX_FLATTEN_ROWS.toLocaleString('en-US')} rows; flatten a smaller table.`);
  const result = flattenJsonColumn(db, {
    table: table.name,
    column: jsonColumn.name,
    keyColumn: keyColumn.name,
    rows,
    keys: body.keys,
    mode: body.mode,
    dryRun: body.dryRun === true,
  });
  return { connectionId: row.id, ...result };
}));

// --- Custom visual plug-ins (V1–V3). Code is returned as JSON text, never served as a script (I8). ---

router.get('/visuals', wrap(() => plugins.listPlugins()));
router.get('/visuals/catalog', wrap(() => plugins.catalogEntries()));
router.get('/visuals/catalog/:type', wrap((req) => plugins.catalogPackage(req.params.type)));
router.post('/visuals/catalog/:type/install', wrap((req) => plugins.installFromCatalog(req.params.type)));
router.post('/visuals', wrap((req) => plugins.savePlugin(req.body?.manifest, req.body?.code, 'imported')));
router.get('/visuals/:type/code', wrap((req) => plugins.pluginCode(req.params.type)));
router.delete('/visuals/:type', wrap((req) => plugins.removePlugin(req.params.type)));

ensureMetaSchema();
connectors.ensureConnectorSchema();
plugins.ensurePluginSchema();
reports.seedReports();
reports.seedCategories();

module.exports = router;

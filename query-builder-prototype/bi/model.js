'use strict';

const fs = require('fs');
const path = require('path');
const connections = require('../connections');
const { getDb: getMetaDb } = require('../db');
const { badRequest, notFound } = require('./errors');

const MODELS_DIR = path.join(__dirname, '..', 'models');

// Tables in the metadata database that are app bookkeeping, never report data.
const INTERNAL_TABLES = new Set([
  'connections', 'measures', 'dashboards', 'dashboard_charts', 'raw_events', 'bi_reports', 'bi_measures', 'bi_columns', 'bi_dataset_filters',
]);

/**
 * The one place identifiers are quoted. Callers only ever pass names that were
 * resolved from the model (invariant I1), so this is defence in depth, not the
 * validation itself.
 */
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Maps a declared SQLite column type to a contract dataType. */
function dataTypeOf(declared) {
  const t = String(declared || '').toUpperCase();
  if (t.includes('BOOL')) return 'boolean';
  if (t.includes('DATETIME') || t.includes('TIMESTAMP')) return 'datetime';
  if (t.includes('INT')) return 'integer';
  if (t.includes('DATE') || t.includes('TIME')) return 'date';
  if (/REAL|FLOA|DOUB|NUM|DEC/.test(t)) return 'number';
  return 'text';
}

function ensureMetaSchema(meta = getMetaDb()) {
  meta.exec(`
    CREATE TABLE IF NOT EXISTS bi_measures (
      id INTEGER PRIMARY KEY,
      model_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      name TEXT NOT NULL,
      expression TEXT NOT NULL,
      format TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (model_id, name)
    );
    CREATE TABLE IF NOT EXISTS bi_columns (
      id INTEGER PRIMARY KEY,
      model_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      name TEXT NOT NULL,
      expression TEXT NOT NULL,
      format TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (model_id, table_name, name)
    );
    CREATE TABLE IF NOT EXISTS bi_dataset_filters (
      model_id INTEGER PRIMARY KEY,
      filters_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function readOverlay(fileName) {
  const file = path.join(MODELS_DIR, `${path.basename(fileName)}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/**
 * Builds a semantic model from a live database: tables and declared types from
 * the schema, relationships from real foreign keys, then an optional overlay
 * (sort-by, hidden, type overrides, extra relationships, measures) and user
 * measures. Pure over its inputs so tests can pass an in-memory database.
 */
function buildModel({ id, name, db, exclude = new Set(), overlay = {}, userMeasures = [], userColumns = [], counts = true }) {
  const tableRows = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .filter((r) => !exclude.has(r.name));
  const tableNames = tableRows.map((r) => r.name);

  // Row counts scan every table; only the model browser needs them, never the query path.
  const tables = tableRows.map(({ name: tableName, sql }) => ({
    name: tableName,
    rowCount: counts ? db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)}`).get().c : null,
    ...(/WITHOUT\s+ROWID/i.test(sql || '') && { withoutRowid: true }),
    hidden: false,
    columns: db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all().map((c) => ({
      name: c.name,
      dataType: dataTypeOf(c.type),
      hidden: false,
    })),
  }));
  const model = { id, name: overlay.name || name, tables, relationships: [], measures: [] };

  for (const t of tables) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${quoteIdent(t.name)})`).all()) {
      if (!tableNames.includes(fk.table)) continue;
      model.relationships.push({ fromTable: t.name, fromColumn: fk.from, toTable: fk.table, toColumn: fk.to, source: 'foreignKey' });
    }
  }

  applyOverlay(model, overlay);

  for (const c of userColumns) {
    const table = model.tables.find((t) => t.name === c.table_name);
    if (!table || table.columns.some((x) => x.name === c.name)) continue;
    table.columns.push({ id: c.id, name: c.name, dataType: 'text', hidden: false, expression: c.expression, format: c.format || undefined, origin: 'user' });
  }
  for (const m of userMeasures) {
    model.measures.push({ id: m.id, name: m.name, table: m.table_name, expression: m.expression, format: m.format || undefined, origin: 'user' });
  }
  // Calculated columns take their type from their formula (F5). Required lazily: dax.js requires this module.
  require('./dax').inferColumnTypes(model);
  return model;
}

function applyOverlay(model, overlay) {
  const where = `model overlay for "${model.name}"`;
  for (const c of overlay.calculatedColumns || []) {
    const table = model.tables.find((t) => t.name === c.table);
    if (!table) throw new Error(`${where}: calculated column "${c.name}" is on table "${c.table}", which does not exist`);
    if (table.columns.some((x) => x.name === c.name)) throw new Error(`${where}: calculated column "${c.table}"."${c.name}" clashes with an existing column`);
    table.columns.push({ id: null, name: c.name, dataType: 'text', hidden: false, expression: c.expression, format: c.format, origin: 'model' });
  }
  for (const [tableName, tableOverlay] of Object.entries(overlay.tables || {})) {
    const table = model.tables.find((t) => t.name === tableName);
    if (!table) throw new Error(`${where}: table "${tableName}" does not exist`);
    if (tableOverlay.hidden) table.hidden = true;
    for (const [colName, colOverlay] of Object.entries(tableOverlay.columns || {})) {
      const col = table.columns.find((c) => c.name === colName);
      if (!col) throw new Error(`${where}: column "${tableName}"."${colName}" does not exist`);
      if (colOverlay.dataType) col.dataType = colOverlay.dataType;
      if (colOverlay.hidden) col.hidden = true;
      if (colOverlay.format) col.format = colOverlay.format;
      if (colOverlay.sortBy) {
        if (!table.columns.some((c) => c.name === colOverlay.sortBy)) {
          throw new Error(`${where}: sortBy column "${colOverlay.sortBy}" is not in table "${tableName}"`);
        }
        col.sortBy = colOverlay.sortBy;
      }
    }
  }
  for (const rel of overlay.relationships || []) {
    for (const [t, c] of [[rel.fromTable, rel.fromColumn], [rel.toTable, rel.toColumn]]) {
      if (!model.tables.find((x) => x.name === t)?.columns.some((x) => x.name === c)) {
        throw new Error(`${where}: relationship column "${t}"."${c}" does not exist`);
      }
    }
    model.relationships.push({ ...rel, source: 'overlay' });
  }
  for (const m of overlay.measures || []) {
    if (!model.tables.some((t) => t.name === m.table)) throw new Error(`${where}: measure "${m.name}" home table "${m.table}" does not exist`);
    model.measures.push({ id: null, name: m.name, table: m.table, expression: m.expression, format: m.format, origin: 'model' });
  }
}

function connectionRow(modelId) {
  const row = getMetaDb().prepare('SELECT id, name, file_name FROM connections WHERE id = ?').get(Number(modelId));
  if (!row) throw notFound(`No model or connection with id ${modelId}`);
  return row;
}

/** Loads the live model for a registered connection (model id = connection id). */
function loadModel(modelId, { counts = true } = {}) {
  const row = connectionRow(modelId);
  ensureMetaSchema();
  const db = connections.getDb(row.id, row.file_name);
  const model = buildModel({
    id: row.id,
    name: row.name,
    db,
    counts,
    exclude: row.file_name === connections.ROOT_DB_FILE ? INTERNAL_TABLES : new Set(),
    overlay: readOverlay(row.file_name),
    userMeasures: getMetaDb().prepare('SELECT * FROM bi_measures WHERE model_id = ? ORDER BY name').all(row.id),
    userColumns: getMetaDb().prepare('SELECT * FROM bi_columns WHERE model_id = ? ORDER BY id').all(row.id),
  });
  // Dataset (data-source level) filters: applied by the query compiler to every request on this model.
  const stored = getMetaDb().prepare('SELECT filters_json FROM bi_dataset_filters WHERE model_id = ?').get(row.id);
  model.datasetFilters = stored ? JSON.parse(stored.filters_json) : [];
  return model;
}

/** Model plus the database handle its queries run on. */
function openModel(modelId) {
  const row = connectionRow(modelId);
  return { model: loadModel(modelId, { counts: false }), db: connections.getDb(row.id, row.file_name) };
}

function listModels() {
  return getMetaDb()
    .prepare('SELECT id, name, file_name FROM connections ORDER BY id')
    .all()
    .map((row) => {
      try {
        const model = loadModel(row.id, { counts: false });
        return { id: row.id, name: model.name, fileName: row.file_name, driver: 'node:sqlite', status: 'connected', tableCount: model.tables.length, error: null };
      } catch (e) {
        return { id: row.id, name: row.name, fileName: row.file_name, driver: 'node:sqlite', status: 'error', tableCount: 0, error: e.message };
      }
    });
}

function findTable(model, tableName) {
  const table = model.tables.find((t) => t.name === tableName);
  if (!table) throw badRequest(`Unknown table "${tableName}" in model "${model.name}"`);
  return table;
}

function findColumn(model, ref) {
  if (!ref || typeof ref.table !== 'string' || typeof ref.column !== 'string') {
    throw badRequest('A field reference needs string "table" and "column"');
  }
  const col = findTable(model, ref.table).columns.find((c) => c.name === ref.column);
  if (!col) throw badRequest(`Unknown column "${ref.column}" in table "${ref.table}"`);
  return col;
}

function findMeasure(model, measureName) {
  const m = model.measures.find((x) => x.name === measureName);
  if (!m) throw badRequest(`Unknown measure "${measureName}" in model "${model.name}"`);
  return m;
}

module.exports = {
  MODELS_DIR,
  quoteIdent,
  dataTypeOf,
  ensureMetaSchema,
  buildModel,
  loadModel,
  openModel,
  listModels,
  findTable,
  findColumn,
  findMeasure,
};

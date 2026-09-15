'use strict';

/** Express router for docs/api/bi-contract.openapi.yaml, mounted at /api/bi. */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const connections = require('../connections');
const { getDb: getMetaDb } = require('../db');
const { listModels, loadModel, openModel, findTable, ensureMetaSchema } = require('./model');
const { validateExpression } = require('./dax');
const { runQuery, runRows, runValues } = require('./query');
const { ingestJson } = require('./ingest');
const reports = require('./reports');
const { badRequest, notFound } = require('./errors');

const IMPORTS_FILE = 'json-imports.db';
const router = express.Router();
const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    next(e);
  }
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

router.post('/measures/validate', wrap((req) => {
  const model = loadModel(modelIdOf(req.body));
  findTable(model, req.body.table);
  return validateExpression(model, req.body.table, req.body.expression);
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
router.post('/connections', wrap((req) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const fileName = req.body?.fileName;
  if (!name || name.length > 100) throw badRequest('Give the connection a name of 1 to 100 characters.');
  if (typeof fileName !== 'string') throw badRequest('Pick one of the available files.');
  try {
    connections.getFilePath(0, fileName);
  } catch (e) {
    throw badRequest(e.message);
  }
  const meta = getMetaDb();
  if (meta.prepare('SELECT 1 FROM connections WHERE file_name = ?').get(fileName)) throw badRequest(`"${fileName}" is already connected.`);
  const info = meta.prepare('INSERT INTO connections (name, file_name, created_at) VALUES (?, ?, ?)').run(name, fileName, new Date().toISOString());
  return { id: Number(info.lastInsertRowid) };
}));
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

ensureMetaSchema();
reports.seedReports();

module.exports = router;

'use strict';

const { getDb: getMetaDb } = require('../db');
const { loadModel, findColumn, findMeasure } = require('./model');
const { badRequest, notFound } = require('./errors');

const FILTER_KINDS = new Set(['basic', 'advanced', 'range', 'relativeDate', 'topN']);
const MAX_DEFINITION_BYTES = 1024 * 1024;

function ensureSchema(meta = getMetaDb()) {
  meta.exec(`
    CREATE TABLE IF NOT EXISTS bi_reports (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      model_id INTEGER NOT NULL,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function validateFilters(model, filters, where) {
  if (!Array.isArray(filters)) throw badRequest(`${where}: filters must be an array.`);
  for (const f of filters) {
    if (!f || !FILTER_KINDS.has(f.kind)) throw badRequest(`${where}: unknown filter kind "${f?.kind}".`);
    findColumn(model, f.target);
    if (f.kind === 'topN') findMeasure(model, f.by);
  }
}

/** Checks every field, measure and filter a report refers to against its model, so broken reports never save. */
function validateDefinition(model, def) {
  if (!def || typeof def !== 'object') throw badRequest('definition must be an object with filters and pages.');
  if (Buffer.byteLength(JSON.stringify(def)) > MAX_DEFINITION_BYTES) throw badRequest('The report definition is larger than 1 MB.');
  validateFilters(model, def.filters, 'Report');
  if (!Array.isArray(def.pages) || !def.pages.length) throw badRequest('A report needs at least one page.');

  const visualIds = new Set();
  for (const page of def.pages) {
    if (!page || typeof page.id !== 'string' || typeof page.name !== 'string' || !page.name.trim()) {
      throw badRequest('Each page needs a string id and a name.');
    }
    validateFilters(model, page.filters, `Page "${page.name}"`);
    if (!Array.isArray(page.visuals)) throw badRequest(`Page "${page.name}": visuals must be an array.`);
    for (const v of page.visuals) {
      if (!v || typeof v.id !== 'string' || visualIds.has(v.id)) throw badRequest(`Page "${page.name}": every visual needs a unique string id.`);
      visualIds.add(v.id);
      if (typeof v.type !== 'string' || !/^[a-z][a-zA-Z0-9-]{0,40}$/.test(v.type)) throw badRequest(`Visual "${v.id}": type must be a registry name like "column".`);
      const where = `Visual "${v.title || v.id}"`;
      if (!v.roles || typeof v.roles !== 'object') throw badRequest(`${where}: roles must be an object.`);
      for (const [role, items] of Object.entries(v.roles)) {
        if (!Array.isArray(items)) throw badRequest(`${where}: role "${role}" must be an array.`);
        for (const item of items) {
          if (item && typeof item.measure === 'string') findMeasure(model, item.measure);
          else {
            const col = findColumn(model, item);
            if (item.dateLevel !== undefined && (col.dataType !== 'date' || !['year', 'quarter', 'month'].includes(item.dateLevel))) {
              throw badRequest(`${where}: dateLevel needs a date column and one of year, quarter, month.`);
            }
          }
        }
      }
      validateFilters(model, v.filters ?? [], where);
    }
  }
}

function toReport(row) {
  return { id: row.id, name: row.name, modelId: row.model_id, definition: JSON.parse(row.definition_json), createdAt: row.created_at, updatedAt: row.updated_at };
}

function checkInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) throw badRequest('Give the report a name of 1 to 120 characters.');
  if (!Number.isInteger(body.modelId)) throw badRequest('modelId must be a model id.');
  validateDefinition(loadModel(body.modelId), body.definition);
  return { name, modelId: body.modelId, json: JSON.stringify(body.definition) };
}

function listReports() {
  ensureSchema();
  return getMetaDb().prepare('SELECT id, name, model_id, updated_at FROM bi_reports ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, modelId: r.model_id, updatedAt: r.updated_at }));
}

function getReport(id) {
  ensureSchema();
  const row = getMetaDb().prepare('SELECT * FROM bi_reports WHERE id = ?').get(Number(id));
  if (!row) throw notFound(`No report with id ${id}`);
  return toReport(row);
}

function createReport(body) {
  ensureSchema();
  const { name, modelId, json } = checkInput(body);
  const now = new Date().toISOString();
  const info = getMetaDb().prepare('INSERT INTO bi_reports (name, model_id, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, modelId, json, now, now);
  return getReport(Number(info.lastInsertRowid));
}

function updateReport(id, body) {
  getReport(id);
  const { name, modelId, json } = checkInput(body);
  getMetaDb().prepare('UPDATE bi_reports SET name = ?, model_id = ?, definition_json = ?, updated_at = ? WHERE id = ?')
    .run(name, modelId, json, new Date().toISOString(), Number(id));
  return getReport(id);
}

function deleteReport(id) {
  ensureSchema();
  getMetaDb().prepare('DELETE FROM bi_reports WHERE id = ?').run(Number(id));
}

// --- Seeded reports: the Wells page mirrors the Power BI report; Operations and Sales show relationships and multiple sources.

const W = 'WellsReadinessPlanVsActual';
const wf = (column) => ({ table: W, column });

const SEEDS = {
  'wells.db': {
    name: 'Wells Readiness - Plan vs Actual',
    definition: {
      filters: [],
      pages: [{
        id: 'plan-vs-actual',
        name: 'Plan vs Actual',
        filters: [],
        visuals: [
          { id: 'plant', type: 'slicer', title: 'Plant', roles: { field: [wf('Plant Description')] }, filters: [], options: { mode: 'dropdown' }, layout: { x: 0, y: 0, w: 4, h: 2 } },
          { id: 'well-type', type: 'slicer', title: 'Well Type', roles: { field: [wf('Well Type')] }, filters: [], options: { mode: 'dropdown' }, layout: { x: 4, y: 0, w: 4, h: 2 } },
          { id: 'planned-completion', type: 'slicer', title: 'Planned Completion Date', roles: { field: [wf('Planned Completion Date (Date)')] }, filters: [], options: { mode: 'between' }, layout: { x: 8, y: 0, w: 4, h: 2 } },
          {
            id: 'readiness', type: 'column', title: 'Wells Readiness - Plan v/s Actual',
            roles: { category: [wf('Parameter')], values: [{ measure: 'Well Count' }] }, filters: [],
            options: { subtitle: 'Well Count by Parameter', dataLabels: true, valueAxisTitle: 'Count (Nos)' },
            layout: { x: 0, y: 2, w: 12, h: 8 },
          },
          {
            id: 'details', type: 'table', title: 'Well Details',
            roles: { columns: ['Plant Description', 'PDO Well ID', 'Well Name (after Spud)', 'Well Type', 'Parameter', 'Planned Completion Date (Date)', 'Actual Completion Date', 'Issue Details'].map(wf) },
            filters: [], layout: { x: 0, y: 10, w: 12, h: 8 },
          },
        ],
      }],
    },
  },
  'data.db': {
    name: 'Operations Overview',
    definition: {
      filters: [],
      pages: [{
        id: 'overview',
        name: 'Overview',
        filters: [],
        visuals: [
          { id: 'region', type: 'slicer', title: 'Region', roles: { field: [{ table: 'crews', column: 'region' }] }, filters: [], options: { mode: 'list' }, layout: { x: 0, y: 0, w: 3, h: 4 } },
          { id: 'task-date', type: 'slicer', title: 'Task date', roles: { field: [{ table: 'tasks', column: 'task_date' }] }, filters: [], options: { mode: 'relativeDate' }, layout: { x: 3, y: 0, w: 3, h: 2 } },
          { id: 'productivity-card', type: 'card', title: 'Productivity %', roles: { values: [{ measure: 'Productivity %' }] }, filters: [], layout: { x: 6, y: 0, w: 3, h: 2 } },
          { id: 'hours-card', type: 'card', title: 'Actual Hours', roles: { values: [{ measure: 'Actual Hours' }] }, filters: [], layout: { x: 9, y: 0, w: 3, h: 2 } },
          { id: 'productivity-by-crew', type: 'bar', title: 'Productivity % by Crew', roles: { category: [{ table: 'crews', column: 'name' }], values: [{ measure: 'Productivity %' }] }, filters: [], layout: { x: 3, y: 2, w: 5, h: 6 } },
          { id: 'status', type: 'column', title: 'Tasks by Status', roles: { category: [{ table: 'tasks', column: 'status' }], values: [{ measure: 'Task Count' }] }, filters: [], layout: { x: 8, y: 2, w: 4, h: 6 } },
          { id: 'monthly', type: 'line', title: 'Actual vs Planned Quantity by Month', roles: { category: [{ table: 'tasks', column: 'task_date', dateLevel: 'month' }], values: [{ measure: 'Actual Quantity' }, { measure: 'Planned Quantity' }] }, filters: [], layout: { x: 0, y: 8, w: 8, h: 6 } },
          { id: 'equipment', type: 'donut', title: 'Tasks by Equipment Type', roles: { category: [{ table: 'equipment', column: 'type' }], values: [{ measure: 'Task Count' }] }, filters: [], layout: { x: 8, y: 8, w: 4, h: 6 } },
          {
            id: 'task-details', type: 'table', title: 'Task Details',
            roles: { columns: [['tasks', 'id'], ['crews', 'name'], ['equipment', 'type'], ['tasks', 'status'], ['tasks', 'task_date'], ['tasks', 'actual_quantity'], ['tasks', 'planned_quantity']].map(([table, column]) => ({ table, column })) },
            filters: [], layout: { x: 0, y: 14, w: 12, h: 7 },
          },
        ],
      }],
    },
  },
  'sales.db': {
    name: 'Sales Pipeline',
    definition: {
      filters: [],
      pages: [{
        id: 'pipeline',
        name: 'Pipeline',
        filters: [],
        visuals: [
          { id: 'industry', type: 'slicer', title: 'Industry', roles: { field: [{ table: 'customers', column: 'industry' }] }, filters: [], options: { mode: 'dropdown' }, layout: { x: 0, y: 0, w: 4, h: 2 } },
          { id: 'deal-amount', type: 'card', title: 'Deal Amount', roles: { values: [{ measure: 'Deal Amount' }] }, filters: [], layout: { x: 4, y: 0, w: 4, h: 2 } },
          { id: 'deal-count', type: 'card', title: 'Deals', roles: { values: [{ measure: 'Deal Count' }] }, filters: [], layout: { x: 8, y: 0, w: 4, h: 2 } },
          { id: 'by-stage', type: 'column', title: 'Deal Amount by Stage', roles: { category: [{ table: 'deals', column: 'stage' }], values: [{ measure: 'Deal Amount' }] }, filters: [], layout: { x: 0, y: 2, w: 6, h: 6 } },
          { id: 'by-region', type: 'bar', title: 'Deal Amount by Region', roles: { category: [{ table: 'customers', column: 'region' }], values: [{ measure: 'Deal Amount' }] }, filters: [], layout: { x: 6, y: 2, w: 6, h: 6 } },
          { id: 'by-category', type: 'pie', title: 'Deals by Product Category', roles: { category: [{ table: 'products', column: 'category' }], values: [{ measure: 'Deal Count' }] }, filters: [], layout: { x: 0, y: 8, w: 5, h: 6 } },
          {
            id: 'deal-details', type: 'table', title: 'Deals',
            roles: { columns: [['deals', 'id'], ['customers', 'name'], ['products', 'name'], ['deals', 'stage'], ['deals', 'amount'], ['deals', 'close_date']].map(([table, column]) => ({ table, column })) },
            filters: [], layout: { x: 5, y: 8, w: 7, h: 6 },
          },
        ],
      }],
    },
  },
};

/** Creates each seed report once, when its connection is registered and no report for that model exists yet. */
function seedReports() {
  ensureSchema();
  const meta = getMetaDb();
  for (const [fileName, seed] of Object.entries(SEEDS)) {
    const conn = meta.prepare('SELECT id FROM connections WHERE file_name = ?').get(fileName);
    if (!conn || meta.prepare('SELECT 1 FROM bi_reports WHERE model_id = ?').get(conn.id)) continue;
    try {
      createReport({ name: seed.name, modelId: conn.id, definition: seed.definition });
    } catch (e) {
      console.warn(`[bi] Skipped seeding "${seed.name}": ${e.message}`);
    }
  }
}

module.exports = { listReports, getReport, createReport, updateReport, deleteReport, validateDefinition, seedReports };

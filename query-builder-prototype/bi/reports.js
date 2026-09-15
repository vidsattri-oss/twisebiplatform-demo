'use strict';

const { getDb: getMetaDb } = require('../db');
const { loadModel, findColumn, findMeasure } = require('./model');
const { badRequest, notFound } = require('./errors');

const FILTER_KINDS = new Set(['basic', 'advanced', 'range', 'relativeDate', 'relativeTime', 'topN']);
const MAX_DEFINITION_BYTES = 1024 * 1024;
const STATUSES = new Set(['draft', 'published']);
const COLOR = /^#[0-9A-Fa-f]{6}$/;

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
    CREATE TABLE IF NOT EXISTS bi_report_categories (
      name TEXT PRIMARY KEY,
      description TEXT,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);
  // R2: category, description and status arrived after reports existed; add them in place.
  const have = new Set(meta.prepare('PRAGMA table_info(bi_reports)').all().map((c) => c.name));
  for (const [name, type] of [['category', 'TEXT'], ['description', 'TEXT'], ['status', "TEXT NOT NULL DEFAULT 'draft'"]]) {
    if (have.has(name)) continue;
    try {
      meta.exec(`ALTER TABLE bi_reports ADD COLUMN ${name} ${type}`);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }
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
  if (def.settings !== undefined) {
    if (!def.settings || typeof def.settings !== 'object' || Array.isArray(def.settings)) throw badRequest('Report settings must be an object.');
    const { multiSelectWithoutCtrl } = def.settings;
    if (multiSelectWithoutCtrl !== undefined && typeof multiSelectWithoutCtrl !== 'boolean') throw badRequest('settings.multiSelectWithoutCtrl must be true or false.');
  }
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
      const defaultFilter = v.options?.defaultFilter;
      if (defaultFilter !== undefined && defaultFilter !== null) validateFilters(model, [defaultFilter], `${where} default selection`);
    }
  }
}

function toReport(row) {
  return {
    id: row.id,
    name: row.name,
    modelId: row.model_id,
    definition: JSON.parse(row.definition_json),
    category: row.category ?? null,
    description: row.description ?? null,
    status: row.status ?? 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function checkName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 120) throw badRequest('Give the report a name of 1 to 120 characters.');
  return name;
}

function checkInput(body) {
  const name = checkName(body?.name);
  if (!Number.isInteger(body.modelId)) throw badRequest('modelId must be a model id.');
  validateDefinition(loadModel(body.modelId), body.definition);
  return { name, modelId: body.modelId, json: JSON.stringify(body.definition) };
}

/** R2: category, description and status; fields left out keep their current values. */
function checkMeta(body, current = { category: null, description: null, status: 'draft' }) {
  const next = { ...current };
  if (body?.category !== undefined) {
    if (body.category === null || body.category === '') next.category = null;
    else if (typeof body.category !== 'string' || !getMetaDb().prepare('SELECT 1 FROM bi_report_categories WHERE name = ?').get(body.category)) {
      throw badRequest(`There is no category "${body.category}". Add it to the categories first.`);
    } else next.category = body.category;
  }
  if (body?.description !== undefined) {
    if (body.description !== null && (typeof body.description !== 'string' || body.description.length > 300)) throw badRequest('description must be text of at most 300 characters.');
    next.description = body.description?.trim() || null;
  }
  if (body?.status !== undefined) {
    if (!STATUSES.has(body.status)) throw badRequest('status must be "draft" or "published".');
    next.status = body.status;
  }
  return next;
}

/** The visual types a report uses, in first-use order — the report card's preview glyph. */
function visualTypesOf(json) {
  try {
    return [...new Set(JSON.parse(json).pages.flatMap((p) => p.visuals.map((v) => v.type)))].slice(0, 8);
  } catch {
    return [];
  }
}

function listReports() {
  ensureSchema();
  return getMetaDb()
    .prepare('SELECT id, name, model_id, definition_json, category, description, status, created_at, updated_at FROM bi_reports ORDER BY id')
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      modelId: r.model_id,
      category: r.category ?? null,
      description: r.description ?? null,
      status: r.status ?? 'draft',
      visualTypes: visualTypesOf(r.definition_json),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
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
  const meta = checkMeta(body);
  const now = new Date().toISOString();
  const info = getMetaDb()
    .prepare('INSERT INTO bi_reports (name, model_id, definition_json, category, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, modelId, json, meta.category, meta.description, meta.status, now, now);
  return getReport(Number(info.lastInsertRowid));
}

function updateReport(id, body) {
  const current = getReport(id);
  const { name, modelId, json } = checkInput(body);
  const meta = checkMeta(body, current);
  getMetaDb()
    .prepare('UPDATE bi_reports SET name = ?, model_id = ?, definition_json = ?, category = ?, description = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(name, modelId, json, meta.category, meta.description, meta.status, new Date().toISOString(), Number(id));
  return getReport(id);
}

/** Rename, move to a category, describe, publish or unpublish without resending the definition. */
function patchReport(id, body) {
  const current = getReport(id);
  const name = body?.name === undefined ? current.name : checkName(body.name);
  const meta = checkMeta(body, current);
  getMetaDb()
    .prepare('UPDATE bi_reports SET name = ?, category = ?, description = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(name, meta.category, meta.description, meta.status, new Date().toISOString(), Number(id));
  return getReport(id);
}

/** A draft copy in the same category. */
function duplicateReport(id) {
  const source = getReport(id);
  const name = `${source.name} (copy)`.slice(0, 120);
  return createReport({ name, modelId: source.modelId, definition: source.definition, category: source.category, description: source.description, status: 'draft' });
}

// --- Categories (R2) ---------------------------------------------------------------

function listCategories() {
  ensureSchema();
  const counts = new Map(getMetaDb().prepare('SELECT category, COUNT(*) AS c FROM bi_reports WHERE category IS NOT NULL GROUP BY category').all().map((r) => [r.category, r.c]));
  return getMetaDb()
    .prepare('SELECT name, description, color, sort_order FROM bi_report_categories ORDER BY sort_order, name')
    .all()
    .map((c) => ({ name: c.name, description: c.description ?? null, color: c.color, order: c.sort_order, reportCount: counts.get(c.name) ?? 0 }));
}

/** Replaces the category list. Reports in a removed category become uncategorised; a renamed one is a remove plus an add. */
function saveCategories(list) {
  ensureSchema();
  if (!Array.isArray(list) || list.length > 30) throw badRequest('categories must be a list of at most 30 categories.');
  const seen = new Set();
  const clean = list.map((c, i) => {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    if (!name || name.length > 60) throw badRequest('Each category needs a name of 1 to 60 characters.');
    if (seen.has(name.toLowerCase())) throw badRequest(`The category "${name}" appears twice.`);
    seen.add(name.toLowerCase());
    if (c.description !== undefined && c.description !== null && (typeof c.description !== 'string' || c.description.length > 200)) {
      throw badRequest(`The description of "${name}" must be text of at most 200 characters.`);
    }
    const color = c.color ?? '#59585D';
    if (typeof color !== 'string' || !COLOR.test(color)) throw badRequest(`The colour of "${name}" must look like #2841A3.`);
    return { name, description: c.description?.trim() || null, color: color.toUpperCase(), order: i };
  });
  const meta = getMetaDb();
  meta.exec('BEGIN');
  try {
    meta.exec('DELETE FROM bi_report_categories');
    const insert = meta.prepare('INSERT INTO bi_report_categories (name, description, color, sort_order) VALUES (?, ?, ?, ?)');
    for (const c of clean) insert.run(c.name, c.description, c.color, c.order);
    const keep = clean.map((c) => c.name);
    const reports = meta.prepare('SELECT id, category FROM bi_reports WHERE category IS NOT NULL').all();
    const clear = meta.prepare('UPDATE bi_reports SET category = NULL WHERE id = ?');
    for (const r of reports) if (!keep.includes(r.category)) clear.run(r.id);
    meta.exec('COMMIT');
  } catch (e) {
    meta.exec('ROLLBACK');
    throw e;
  }
  return listCategories();
}

const DEFAULT_CATEGORIES = [
  { name: 'Operational Dashboard', description: 'Plan vs actual readiness, delivery and status across wells and clusters.', color: '#2841A3' },
  { name: 'Productivity', description: 'Crew and equipment productivity against plan.', color: '#E38200' },
  { name: 'Operational', description: 'Daily logs, work orders and field activity.', color: '#0E8A7E' },
  { name: 'Commercial', description: 'Pipeline, customers and deals.', color: '#6A4BC4' },
];

/** Where the demo reports belong. Applied once, only to reports that have no category yet. */
const DEMO_REPORT_META = {
  'Wells Readiness - Plan vs Actual': { category: 'Operational Dashboard', description: 'Plan v/s actual readiness funnel: drilled, excluded, due and completed wells.' },
  'Operations Overview': { category: 'Productivity', description: 'Productivity %, hours and task status by crew and region.' },
  'Plug-in visuals demo': { category: 'Productivity', description: 'Bullet chart and heat map plug-ins with a KPI status card.' },
  'AppMasterDB daily logs': { category: 'Operational', description: 'Daily logs with relative date, relative time and completion slicers.' },
  'Sales Pipeline': { category: 'Commercial', description: 'Deal amount by stage, region and product category.' },
};

function seedCategories() {
  ensureSchema();
  const meta = getMetaDb();
  if (meta.prepare('SELECT COUNT(*) AS c FROM bi_report_categories').get().c > 0) return;
  const insert = meta.prepare('INSERT OR IGNORE INTO bi_report_categories (name, description, color, sort_order) VALUES (?, ?, ?, ?)');
  DEFAULT_CATEGORIES.forEach((c, i) => insert.run(c.name, c.description, c.color, i));
  const update = meta.prepare("UPDATE bi_reports SET category = ?, description = COALESCE(description, ?), status = 'published' WHERE name = ? AND category IS NULL");
  for (const [name, m] of Object.entries(DEMO_REPORT_META)) update.run(m.category, m.description, name);
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

module.exports = {
  listReports,
  getReport,
  createReport,
  updateReport,
  patchReport,
  duplicateReport,
  deleteReport,
  listCategories,
  saveCategories,
  seedCategories,
  validateDefinition,
  validateFilters,
  seedReports,
};

'use strict';

/**
 * JSON ingestion (spec R4), following Power Query's semantics rather than the
 * old prototype's indexed columns (employee_ids[0], [1]…):
 * - a nested record expands into columns ("daily_data.metrics.actual_hours");
 * - a list becomes rows in a child table with _parent_id REFERENCES parent(_id),
 *   so the model picks up the relationship from the real foreign key.
 * Existing tables gain new columns when later payloads add fields, and
 * mode "replace" clears previous rows so re-imports don't duplicate.
 */

const { badRequest } = require('./errors');
const { quoteIdent, dataTypeOf } = require('./model');

const LIMITS = { records: 50000, rows: 200000, columns: 500, depth: 20 };
const RESERVED = new Set(['_id', '_parent_id']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeName(name) {
  // Runs of underscores collapse to one, so "__" only ever means parent__child and names can't collide.
  const cleaned = String(name ?? '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  if (!cleaned) throw badRequest('Give the table a name made of letters, digits or underscores.');
  return cleaned;
}

function columnName(path) {
  const name = path.replace(/[\u0000-\u001f"]/g, '').slice(0, 128);
  return RESERVED.has(name) ? `json${name}` : name;
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Builds the table plan (names, column types, row tree) without touching a database. */
function planTables(tableName, records) {
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) throw badRequest('records is empty — send an object or a non-empty array of objects.');
  if (list.length > LIMITS.records) throw badRequest(`At most ${LIMITS.records} records can be ingested at once.`);
  if (!list.every(isRecord)) throw badRequest('records must be an object or an array of objects.');

  const tables = new Map();
  let rowCount = 0;
  const tableFor = (name, parent) => {
    if (!tables.has(name)) tables.set(name, { name, parent, columns: new Map(), rows: [] });
    return tables.get(name);
  };
  const observe = (table, col, value) => {
    if (!table.columns.has(col)) {
      if (table.columns.size >= LIMITS.columns) throw badRequest(`Table "${table.name}" would have more than ${LIMITS.columns} columns.`);
      table.columns.set(col, new Set());
    }
    if (value !== null) table.columns.get(col).add(kindOf(value));
  };

  function addRow(table, value, depth) {
    if (depth > LIMITS.depth) throw badRequest(`JSON is nested more than ${LIMITS.depth} levels deep.`);
    if (++rowCount > LIMITS.rows) throw badRequest(`The payload expands to more than ${LIMITS.rows} rows.`);
    const row = { values: {}, children: [] };
    table.rows.push(row);
    if (isRecord(value)) expand(table, row, value, '', depth);
    else {
      const scalar = Array.isArray(value) ? JSON.stringify(value) : value;
      observe(table, 'value', scalar ?? null);
      row.values.value = scalar ?? null;
    }
    return row;
  }

  function expand(table, row, obj, prefix, depth) {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isRecord(value)) {
        expand(table, row, value, path, depth);
      } else if (Array.isArray(value)) {
        const child = tableFor(`${table.name}__${sanitizeName(path)}`, table.name);
        for (const item of value) row.children.push({ table: child, row: addRow(child, item, depth + 1) });
      } else {
        const col = columnName(path);
        observe(table, col, value ?? null);
        row.values[col] = value ?? null;
      }
    }
  }

  const root = tableFor(`json_${sanitizeName(tableName)}`, null);
  const roots = list.map((record) => addRow(root, record, 0));
  return { root, tables: [...tables.values()], roots };
}

function kindOf(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string' && DATE_RE.test(value)) return 'date';
  return 'text';
}

function sqlType(kinds) {
  if (kinds.size === 0) return 'TEXT';
  if (kinds.size === 1) return { boolean: 'BOOLEAN', integer: 'INTEGER', number: 'REAL', date: 'DATE', text: 'TEXT' }[[...kinds][0]];
  if ([...kinds].every((k) => k === 'integer' || k === 'number')) return 'REAL';
  return 'TEXT';
}

function storeValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value ?? null;
}

function existingColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => c.name));
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function ingestJson(db, { tableName, records, mode = 'append', dryRun = false }) {
  if (mode !== 'append' && mode !== 'replace') throw badRequest('mode must be "append" or "replace".');
  const plan = planTables(tableName, records);

  const summary = plan.tables.map((t) => {
    const exists = tableExists(db, t.name);
    const have = exists ? existingColumns(db, t.name) : new Set();
    const columns = [...t.columns].map(([name, kinds]) => ({ name, dataType: dataTypeOf(sqlType(kinds)) }));
    return {
      name: t.name,
      parent: t.parent,
      rowCount: t.rows.length,
      columns,
      addedColumns: exists ? columns.map((c) => c.name).filter((c) => !have.has(c)) : [],
      sample: t.rows.slice(0, 5).map((r) => r.values),
    };
  });
  if (dryRun) return { tables: summary, written: false };

  db.exec('BEGIN');
  try {
    for (const t of plan.tables) {
      const cols = [...t.columns].map(([name, kinds]) => `${quoteIdent(name)} ${sqlType(kinds)}`);
      if (!tableExists(db, t.name)) {
        const link = t.parent ? [`"_parent_id" INTEGER REFERENCES ${quoteIdent(t.parent)}("_id")`] : [];
        db.exec(`CREATE TABLE ${quoteIdent(t.name)} ("_id" INTEGER PRIMARY KEY, ${[...link, ...cols].join(', ') || '"value" TEXT'})`);
      } else {
        const have = existingColumns(db, t.name);
        for (const [name, kinds] of t.columns) {
          if (!have.has(name)) db.exec(`ALTER TABLE ${quoteIdent(t.name)} ADD COLUMN ${quoteIdent(name)} ${sqlType(kinds)}`);
        }
      }
    }

    if (mode === 'replace') {
      const prefix = `${plan.root.name}__`;
      const related = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        .map((r) => r.name)
        .filter((n) => n === plan.root.name || n.startsWith(prefix))
        .sort((a, b) => b.length - a.length); // deepest child tables first
      for (const name of related) db.exec(`DELETE FROM ${quoteIdent(name)}`);
    }

    const inserters = new Map();
    const insert = (table, row, parentId) => {
      const cols = Object.keys(row.values);
      const names = [...(table.parent ? ['_parent_id'] : []), ...cols];
      const key = `${table.name}\u0000${names.join('\u0000')}`;
      if (!inserters.has(key)) {
        const sql = names.length
          ? `INSERT INTO ${quoteIdent(table.name)} (${names.map(quoteIdent).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
          : `INSERT INTO ${quoteIdent(table.name)} DEFAULT VALUES`;
        inserters.set(key, db.prepare(sql));
      }
      const args = [...(table.parent ? [parentId] : []), ...cols.map((c) => storeValue(row.values[c]))];
      const id = Number(inserters.get(key).run(...args).lastInsertRowid);
      for (const child of row.children) insert(child.table, child.row, id);
    };
    for (const row of plan.roots) insert(plan.root, row, null);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { tables: summary, written: true };
}

module.exports = { ingestJson, planTables, sanitizeName };

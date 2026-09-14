const express = require('express');
const path = require('path');
const { getDb, DB_PATH } = require('./db');

const app = express();
const db = getDb();

const ALLOWED_TABLES = ['crews', 'equipment', 'tasks'];
const ALLOWED_AGG = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
const ALLOWED_OPS = { '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Dev-only CORS: the Angular dev server (4200) calls this API (4173) from a
// different origin. Scoped to that one known origin, not a wildcard — this
// backend has no auth yet, so an open CORS policy would let any page in the
// browser read local data through it.
const DEV_ORIGIN = 'http://localhost:4200';
app.use((req, res, next) => {
  if (req.headers.origin === DEV_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', DEV_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Metadata gate: every request below resolves identifiers ONLY against
// the real schema (PRAGMA table_info), the same pattern documented for the
// production Cube.dev-on-RDS design. Nothing here string-concatenates
// unvalidated input into SQL; filter VALUES are always bound parameters. ---

function tableColumns(table) {
  if (!ALLOWED_TABLES.includes(table)) {
    throw new HttpError(400, `Unknown table "${table}"`);
  }
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => ({ name: r.name, type: r.type }));
}

function validateColumn(table, col) {
  const cols = tableColumns(table).map((c) => c.name);
  if (!cols.includes(col)) throw new HttpError(400, `Unknown column "${col}" on "${table}"`);
  return col;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function buildQuery(config) {
  const { table, groupBy, filters = [], metric } = config || {};
  if (!table) throw new HttpError(400, 'table is required');
  if (!ALLOWED_TABLES.includes(table)) throw new HttpError(400, `Unknown table "${table}"`);
  if (!metric || !metric.type) throw new HttpError(400, 'metric is required');

  const gb = groupBy ? validateColumn(table, groupBy) : null;

  let selectMetric;
  if (metric.type === 'agg') {
    if (!ALLOWED_AGG.includes(metric.agg)) throw new HttpError(400, `Unknown aggregation "${metric.agg}"`);
    validateColumn(table, metric.field);
    selectMetric = `${metric.agg}("${metric.field}") AS value`;
  } else if (metric.type === 'ratio') {
    if (!ALLOWED_AGG.includes(metric.agg)) throw new HttpError(400, `Unknown aggregation "${metric.agg}"`);
    validateColumn(table, metric.numerator);
    validateColumn(table, metric.denominator);
    selectMetric = `CAST(${metric.agg}("${metric.numerator}") AS REAL) / NULLIF(${metric.agg}("${metric.denominator}"), 0) AS value`;
  } else {
    throw new HttpError(400, `Unknown metric type "${metric.type}"`);
  }

  const params = [];
  const whereParts = filters.map((f) => {
    validateColumn(table, f.field);
    if (!(f.op in ALLOWED_OPS)) throw new HttpError(400, `Unknown operator "${f.op}"`);
    params.push(f.value);
    return `"${f.field}" ${ALLOWED_OPS[f.op]} ?`;
  });
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const groupSelect = gb ? `"${gb}" AS group_key, ` : '';
  const groupClause = gb ? `GROUP BY "${gb}"` : '';
  const orderClause = gb ? `ORDER BY "${gb}"` : '';

  const sql = `SELECT ${groupSelect}${selectMetric} FROM "${table}" ${where} ${groupClause} ${orderClause}`.replace(/\s+/g, ' ').trim();
  return { sql, params };
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/sources', (req, res, next) => {
  try {
    const tables = ALLOWED_TABLES.map((t) => ({
      name: t,
      rowCount: db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c,
      columns: tableColumns(t),
    }));
    res.json({
      name: 'Local SQLite',
      driver: 'node:sqlite',
      file: DB_PATH,
      status: 'connected',
      lastSynced: new Date().toISOString(),
      tables,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/raw-events', (req, res, next) => {
  try {
    const rows = db.prepare('SELECT id, source, received_at, payload_json FROM raw_events ORDER BY id').all();
    res.json({
      events: rows.map((r) => ({ id: r.id, source: r.source, receivedAt: r.received_at, payload: JSON.parse(r.payload_json) })),
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/tables/:table/schema', (req, res, next) => {
  try {
    res.json({ table: req.params.table, columns: tableColumns(req.params.table) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/tables/:table/preview', (req, res, next) => {
  try {
    const t = req.params.table;
    if (!ALLOWED_TABLES.includes(t)) throw new HttpError(400, `Unknown table "${t}"`);
    const rows = db.prepare(`SELECT * FROM "${t}" LIMIT 8`).all();
    res.json({ rows });
  } catch (e) {
    next(e);
  }
});

app.get('/api/measures', (req, res, next) => {
  try {
    const rows = db.prepare('SELECT * FROM measures ORDER BY created_at DESC').all();
    res.json({ measures: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, config: JSON.parse(r.config_json) })) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/measures', (req, res, next) => {
  try {
    const { name, config } = req.body || {};
    if (!name || !config) throw new HttpError(400, 'name and config are required');
    buildQuery(config); // validates the config against the live schema before persisting
    const stmt = db.prepare('INSERT INTO measures (name, config_json, created_at) VALUES (?, ?, ?)');
    const info = stmt.run(name, JSON.stringify(config), new Date().toISOString());
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/measures/:id', (req, res, next) => {
  try {
    db.prepare('DELETE FROM measures WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.post('/api/query', (req, res, next) => {
  try {
    const { sql, params } = buildQuery(req.body);
    const rows = db.prepare(sql).all(...params);
    res.json({ sql, params, rows });
  } catch (e) {
    next(e);
  }
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, () => {
  console.log(`Query builder prototype running at http://localhost:${PORT}`);
  console.log(`SQLite file: ${DB_PATH}`);
});

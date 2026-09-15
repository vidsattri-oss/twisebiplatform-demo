const express = require('express');
const path = require('path');
const { getDb, DB_PATH } = require('./db');
const connections = require('./connections');
const secrets = require('./secrets');

const app = express();
const db = getDb(); // the app's own metadata store (connections, measures, dashboards) — always connection id 1's file

const ALLOWED_AGG = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
const ALLOWED_OPS = { '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };

app.use(express.json({ limit: '15mb' })); // file-upload ingestion sends JSON rows, not multipart
app.use(express.static(path.join(__dirname, 'public')));

// Dev-only CORS: the Angular dev server (4200) calls this API (4173) from a
// different origin. Scoped to that one known origin, not a wildcard — this
// backend has no auth yet, so an open CORS policy would let any page in the
// browser read local data through it.
const DEV_ORIGIN = 'http://localhost:4200';
app.use((req, res, next) => {
  if (req.headers.origin === DEV_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', DEV_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// The contract the @tasnim/bi library speaks (docs/api/bi-contract.openapi.yaml).
app.use('/api/bi', require('./bi/routes'));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- Connection registry helpers -------------------------------------------------

function listConnectionRows() {
  return db.prepare('SELECT id, name, file_name, created_at FROM connections ORDER BY id').all();
}

function getConnectionRow(connectionId) {
  const row = db.prepare('SELECT id, name, file_name, created_at FROM connections WHERE id = ?').get(connectionId);
  if (!row) throw new HttpError(400, `Unknown connection id ${connectionId}`);
  return row;
}

function connDb(connectionId) {
  const row = getConnectionRow(connectionId);
  return connections.getDb(row.id, row.file_name);
}

// --- Metadata gate: every request below resolves table/column identifiers ONLY
// against the real, live schema of the specific connection involved — never
// hardcoded, never free text into SQL. Adding a new connection makes its
// tables queryable automatically, with no code change here. Filter VALUES
// are always bound parameters. ---

function tableColumns(connectionId, table) {
  const row = getConnectionRow(connectionId);
  const allowed = connections.getQueryableTables(connectionId, row.file_name);
  if (!allowed.includes(table)) {
    throw new HttpError(400, `Unknown table "${table}" on connection ${connectionId}`);
  }
  return connDb(connectionId).prepare(`PRAGMA table_info("${table}")`).all().map((r) => ({ name: r.name, type: r.type }));
}

function validateColumn(connectionId, table, col) {
  const cols = tableColumns(connectionId, table).map((c) => c.name);
  if (!cols.includes(col)) throw new HttpError(400, `Unknown column "${col}" on connection ${connectionId}."${table}"`);
  return col;
}

function sanitizeIdentifier(name) {
  const cleaned = String(name ?? '').trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
  if (!cleaned) throw new HttpError(400, 'Empty identifier');
  return cleaned.slice(0, 64);
}

function buildQuery(config) {
  const { connectionId = 1, table, groupBy, filters = [], metric, join } = config || {};
  if (!table) throw new HttpError(400, 'table is required');
  if (!metric || !metric.type) throw new HttpError(400, 'metric is required');
  const primaryRow = getConnectionRow(connectionId);
  const primaryDb = connDb(connectionId);

  const allowedPrimary = connections.getQueryableTables(connectionId, primaryRow.file_name);
  if (!allowedPrimary.includes(table)) throw new HttpError(400, `Unknown table "${table}" on connection ${connectionId}`);

  const gb = groupBy ? validateColumn(connectionId, table, groupBy) : null;

  let selectMetric;
  if (metric.type === 'agg') {
    if (!ALLOWED_AGG.includes(metric.agg)) throw new HttpError(400, `Unknown aggregation "${metric.agg}"`);
    validateColumn(connectionId, table, metric.field);
    selectMetric = `${metric.agg}("${table}"."${metric.field}") AS value`;
  } else if (metric.type === 'ratio') {
    if (!ALLOWED_AGG.includes(metric.agg)) throw new HttpError(400, `Unknown aggregation "${metric.agg}"`);
    validateColumn(connectionId, table, metric.numerator);
    validateColumn(connectionId, table, metric.denominator);
    selectMetric = `CAST(${metric.agg}("${table}"."${metric.numerator}") AS REAL) / NULLIF(${metric.agg}("${table}"."${metric.denominator}"), 0) AS value`;
  } else {
    throw new HttpError(400, `Unknown metric type "${metric.type}"`);
  }

  const params = [];
  const whereParts = filters.map((f) => {
    validateColumn(connectionId, table, f.field);
    if (!(f.op in ALLOWED_OPS)) throw new HttpError(400, `Unknown operator "${f.op}"`);
    params.push(f.value);
    return `"${table}"."${f.field}" ${ALLOWED_OPS[f.op]} ?`;
  });

  let fromClause = `"${table}"`;

  // --- Cross-connection join: only possible because both sides are SQLite
  // files here — ATTACH DATABASE lets one connection see a second file and
  // JOIN across them directly. A heterogeneous connection (a future real
  // SQL Server, say) cannot do this at all; that's exactly why the
  // production design lands everything in one staging schema first rather
  // than attempting a live cross-engine join. ---
  if (join) {
    const joinRow = getConnectionRow(join.connectionId);
    const joinAllowed = connections.getQueryableTables(join.connectionId, joinRow.file_name);
    if (!joinAllowed.includes(join.table)) throw new HttpError(400, `Unknown table "${join.table}" on connection ${join.connectionId}`);
    validateColumn(connectionId, table, join.leftField);
    validateColumn(join.connectionId, join.table, join.rightField);

    const joinFilePath = connections.getFilePath(join.connectionId, joinRow.file_name);
    connections.ensureAttached(primaryDb, joinFilePath);

    fromClause = `"${table}" JOIN joined."${join.table}" ON "${table}"."${join.leftField}" = joined."${join.table}"."${join.rightField}"`;
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const groupSelect = gb ? `"${table}"."${gb}" AS group_key, ` : '';
  const groupClause = gb ? `GROUP BY "${table}"."${gb}"` : '';
  const orderClause = gb ? `ORDER BY "${table}"."${gb}"` : '';

  const sql = `SELECT ${groupSelect}${selectMetric} FROM ${fromClause} ${where} ${groupClause} ${orderClause}`.replace(/\s+/g, ' ').trim();
  return { sql, params, db: primaryDb };
}

// --- Health -------------------------------------------------------------

app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- Connections ----------------------------------------------------------

app.get('/api/connections', (req, res, next) => {
  try {
    const rows = listConnectionRows();
    const out = rows.map((r) => {
      let tables = [];
      let error = null;
      try {
        tables = connections.getQueryableTables(r.id, r.file_name).map((t) => {
          const cdb = connections.getDb(r.id, r.file_name);
          return { name: t, rowCount: cdb.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c };
        });
      } catch (e) {
        error = e.message;
      }
      return {
        id: r.id,
        name: r.name,
        fileName: r.file_name,
        driver: 'node:sqlite',
        status: error ? 'error' : 'connected',
        createdAt: r.created_at,
        tables,
        error,
      };
    });
    res.json({ connections: out });
  } catch (e) {
    next(e);
  }
});

app.get('/api/connections/available-files', (req, res, next) => {
  try {
    const registered = listConnectionRows().map((r) => r.file_name);
    res.json({ files: connections.listAvailableFiles(registered) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/connections', (req, res, next) => {
  try {
    const { name, fileName, secret } = req.body || {};
    if (!name || !fileName) throw new HttpError(400, 'name and fileName are required');
    // Resolving now both validates the file exists in connections/ (never an
    // arbitrary client-supplied path) and fails fast before touching the DB.
    connections.getFilePath(0, fileName);
    const credentials_enc = secret ? secrets.encrypt(secret) : null;
    const info = db
      .prepare('INSERT INTO connections (name, file_name, credentials_enc, created_at) VALUES (?, ?, ?, ?)')
      .run(name, fileName, credentials_enc, new Date().toISOString());
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/connections/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === 1) throw new HttpError(400, 'The built-in Operations connection cannot be removed');
    db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get('/api/connections/:id/tables/:table/schema', (req, res, next) => {
  try {
    const connectionId = Number(req.params.id);
    res.json({ table: req.params.table, columns: tableColumns(connectionId, req.params.table) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/connections/:id/tables/:table/columns/:column/distinct', (req, res, next) => {
  try {
    const connectionId = Number(req.params.id);
    const col = validateColumn(connectionId, req.params.table, req.params.column);
    const rows = connDb(connectionId)
      .prepare(`SELECT DISTINCT "${col}" AS v FROM "${req.params.table}" WHERE "${col}" IS NOT NULL ORDER BY "${col}" LIMIT 200`)
      .all();
    res.json({ values: rows.map((r) => r.v) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/connections/:id/tables/:table/columns/:column/range', (req, res, next) => {
  try {
    const connectionId = Number(req.params.id);
    const col = validateColumn(connectionId, req.params.table, req.params.column);
    const row = connDb(connectionId).prepare(`SELECT MIN("${col}") AS min, MAX("${col}") AS max FROM "${req.params.table}"`).get();
    res.json({ min: row.min, max: row.max });
  } catch (e) {
    next(e);
  }
});

app.get('/api/connections/:id/tables/:table/preview', (req, res, next) => {
  try {
    const connectionId = Number(req.params.id);
    const row = getConnectionRow(connectionId);
    const allowed = connections.getQueryableTables(connectionId, row.file_name);
    if (!allowed.includes(req.params.table)) throw new HttpError(400, `Unknown table "${req.params.table}"`);
    const rows = connDb(connectionId).prepare(`SELECT * FROM "${req.params.table}" LIMIT 8`).all();
    res.json({ rows });
  } catch (e) {
    next(e);
  }
});

// --- Ingestion: flattened JSON / uploaded file rows -> a real queryable table ---

app.post('/api/ingest', (req, res, next) => {
  try {
    const { connectionId = 1, tableName, rows } = req.body || {};
    if (!tableName || !Array.isArray(rows) || rows.length === 0) {
      throw new HttpError(400, 'tableName and a non-empty rows array are required');
    }
    const row = getConnectionRow(connectionId);
    const targetDb = connections.getDb(row.id, row.file_name);

    const safeTable = `uploaded_${sanitizeIdentifier(tableName)}`;
    const colSet = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => colSet.add(sanitizeIdentifier(k))));
    const cols = Array.from(colSet);
    if (!cols.length) throw new HttpError(400, 'No columns found in the uploaded rows');

    targetDb.exec(`CREATE TABLE IF NOT EXISTS "${safeTable}" (${cols.map((c) => `"${c}" TEXT`).join(', ')})`);
    const insertStmt = targetDb.prepare(
      `INSERT INTO "${safeTable}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    );
    for (const r of rows) {
      const byClean = {};
      Object.entries(r).forEach(([k, v]) => { byClean[sanitizeIdentifier(k)] = v; });
      insertStmt.run(...cols.map((c) => {
        const v = byClean[c];
        if (v === null || v === undefined) return null;
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      }));
    }
    res.json({ connectionId: row.id, table: safeTable, rowCount: rows.length, columns: cols });
  } catch (e) {
    next(e);
  }
});

// --- Raw events (JSON Explorer's seeded demo payloads) --------------------

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

// --- Measures ---------------------------------------------------------------

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

// --- Query engine ----------------------------------------------------------

app.post('/api/query', (req, res, next) => {
  try {
    const { sql, params, db: targetDb } = buildQuery(req.body);
    const rows = targetDb.prepare(sql).all(...params);
    res.json({ sql, params, rows });
  } catch (e) {
    next(e);
  }
});

// --- Drill-down: the individual rows behind one aggregated bar/slice -------

app.post('/api/drilldown', (req, res, next) => {
  try {
    const { connectionId = 1, table, groupBy, groupValue, filters = [] } = req.body || {};
    if (!table) throw new HttpError(400, 'table is required');
    const row = getConnectionRow(connectionId);
    const allowed = connections.getQueryableTables(connectionId, row.file_name);
    if (!allowed.includes(table)) throw new HttpError(400, `Unknown table "${table}"`);

    const params = [];
    const whereParts = filters.map((f) => {
      validateColumn(connectionId, table, f.field);
      if (!(f.op in ALLOWED_OPS)) throw new HttpError(400, `Unknown operator "${f.op}"`);
      params.push(f.value);
      return `"${f.field}" ${ALLOWED_OPS[f.op]} ?`;
    });
    if (groupBy) {
      validateColumn(connectionId, table, groupBy);
      whereParts.push(`"${groupBy}" = ?`);
      params.push(groupValue);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const sql = `SELECT * FROM "${table}" ${where} LIMIT 50`;
    const rows = connDb(connectionId).prepare(sql).all(...params);
    res.json({ sql, params, rows });
  } catch (e) {
    next(e);
  }
});

// --- Dashboards (multiple, user-created) -----------------------------------

app.get('/api/dashboards', (req, res, next) => {
  try {
    const rows = db.prepare('SELECT * FROM dashboards ORDER BY id').all();
    res.json({ dashboards: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at })) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/dashboards', (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) throw new HttpError(400, 'name is required');
    const info = db.prepare('INSERT INTO dashboards (name, created_at) VALUES (?, ?)').run(name, new Date().toISOString());
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/dashboards/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body || {};
    if (!name || !String(name).trim()) throw new HttpError(400, 'name is required');
    const info = db.prepare('UPDATE dashboards SET name = ? WHERE id = ?').run(String(name).trim(), id);
    if (info.changes === 0) throw new HttpError(404, 'Dashboard not found');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/dashboards/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === 1) throw new HttpError(400, 'The default dashboard cannot be removed');
    db.prepare('DELETE FROM dashboard_charts WHERE dashboard_id = ?').run(id);
    db.prepare('DELETE FROM dashboards WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get('/api/dashboards/:id/charts', (req, res, next) => {
  try {
    const rows = db.prepare('SELECT * FROM dashboard_charts WHERE dashboard_id = ? ORDER BY position').all(req.params.id);
    res.json({ charts: rows.map((r) => ({ id: r.id, title: r.title, chartType: r.chart_type, config: JSON.parse(r.config_json), position: r.position })) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/dashboards/:id/charts', (req, res, next) => {
  try {
    const dashboardId = Number(req.params.id);
    const { title, chartType, config } = req.body || {};
    if (!title || !chartType || !config) throw new HttpError(400, 'title, chartType and config are required');
    buildQuery(config); // validate before saving
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM dashboard_charts WHERE dashboard_id = ?').get(dashboardId).m;
    const info = db
      .prepare('INSERT INTO dashboard_charts (dashboard_id, title, chart_type, config_json, position) VALUES (?, ?, ?, ?, ?)')
      .run(dashboardId, title, chartType, JSON.stringify(config), maxPos + 1);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/dashboards/:dashboardId/charts/:chartId', (req, res, next) => {
  try {
    const { dashboardId, chartId } = req.params;
    const existing = db.prepare('SELECT * FROM dashboard_charts WHERE id = ? AND dashboard_id = ?').get(chartId, dashboardId);
    if (!existing) throw new HttpError(404, 'Chart not found');

    const { title, chartType, config } = req.body || {};
    const nextTitle = title !== undefined ? String(title).trim() : existing.title;
    const nextType = chartType !== undefined ? chartType : existing.chart_type;
    const nextConfig = config !== undefined ? config : JSON.parse(existing.config_json);
    if (!nextTitle) throw new HttpError(400, 'title is required');
    buildQuery(nextConfig); // validate before saving — same gate as creating a chart

    db.prepare('UPDATE dashboard_charts SET title = ?, chart_type = ?, config_json = ? WHERE id = ? AND dashboard_id = ?')
      .run(nextTitle, nextType, JSON.stringify(nextConfig), chartId, dashboardId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/dashboards/:dashboardId/charts/:chartId', (req, res, next) => {
  try {
    db.prepare('DELETE FROM dashboard_charts WHERE id = ? AND dashboard_id = ?').run(req.params.chartId, req.params.dashboardId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  // Body-parser errors carry a 4xx status; anything without one is ours, and its
  // message (SQL, file paths) stays in the server log rather than the response.
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server. Check the server log for details.' : err.message,
    ...(err.position !== undefined && { position: err.position }),
  });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 4173;
  app.listen(PORT, () => {
    console.log(`Query builder prototype running at http://localhost:${PORT}`);
    console.log(`SQLite file: ${DB_PATH}`);
    console.log(`Connections directory: ${connections.CONNECTIONS_DIR}`);
  });
}

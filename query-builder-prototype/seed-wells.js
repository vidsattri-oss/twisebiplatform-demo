'use strict';

/**
 * Builds connections/wells.db from the Wells Readiness CSV, mirroring the Power BI
 * model (1_Wells Readiness - Plan vs Actual.SemanticModel) so parity is testable:
 * - every CSV column stays text, as in the Power BI model;
 * - "Parameter Sort Order" = List.PositionOf(OrderList, [Parameter]) + 1 (Power Query step);
 * - "Planned Completion Date (Date)" = DATEVALUE(LEFT([Planned Completion Date], 10)).
 *
 * The CSV is real well data and is never committed. Point WELLS_CSV at it, or
 * leave the default sibling-folder path.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { parseCsv } = require('./bi/csv');
const connections = require('./connections');
const { getDb: getMetaDb } = require('./db');

const DEFAULT_CSV = path.join(__dirname, '..', '..', '1_Wells ReadinessPlan vs Actual', 'Wells Readiness - Plan v_s Actual_drilldown.csv');
const DB_FILE = 'wells.db';
const TABLE = 'WellsReadinessPlanVsActual';
const PARAMETER_ORDER = [
  'Plan - As per Rig Sequence', 'Not Drilled - Not Due', 'Excluded - FLAF Delays', 'Excluded - SCR Delays',
  'Date is Not Due', 'Issues to be Resolved by PDO', 'Wells Suspended', 'Plan - Due Wells',
  'Actual - Wells Completed', 'Shortfall(-) / Excess(+)',
];

const q = (name) => `"${name.replace(/"/g, '""')}"`;

function seedWells(csvPath = process.env.WELLS_CSV || DEFAULT_CSV) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Wells CSV not found at "${csvPath}". Set WELLS_CSV to the export's path.`);
  }
  const { headers, rows } = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  for (const required of ['Parameter', 'Planned Completion Date']) {
    if (!headers.includes(required)) throw new Error(`Wells CSV is missing the "${required}" column.`);
  }

  fs.mkdirSync(connections.CONNECTIONS_DIR, { recursive: true });
  const dbPath = path.join(connections.CONNECTIONS_DIR, DB_FILE);
  const db = new DatabaseSync(dbPath);
  const columnsSql = [
    ...headers.map((h) => `${q(h)} TEXT`),
    `${q('Parameter Sort Order')} INTEGER`,
    `${q('Planned Completion Date (Date)')} DATE`,
  ];
  db.exec(`DROP TABLE IF EXISTS ${q(TABLE)}; CREATE TABLE ${q(TABLE)} (${columnsSql.join(', ')});`);

  const all = [...headers, 'Parameter Sort Order', 'Planned Completion Date (Date)'];
  const insert = db.prepare(`INSERT INTO ${q(TABLE)} (${all.map(q).join(', ')}) VALUES (${all.map(() => '?').join(', ')})`);
  const pIdx = headers.indexOf('Parameter');
  const dIdx = headers.indexOf('Planned Completion Date');

  db.exec('BEGIN');
  for (const r of rows) {
    const cells = headers.map((_, i) => (r[i] === undefined || r[i] === '' ? null : r[i]));
    const planned = r[dIdx] || '';
    const plannedDate = /^\d{4}-\d{2}-\d{2}/.test(planned) ? planned.slice(0, 10) : null;
    insert.run(...cells, PARAMETER_ORDER.indexOf(r[pIdx]) + 1, plannedDate);
  }
  db.exec('COMMIT');
  db.close();

  const meta = getMetaDb();
  if (!meta.prepare('SELECT 1 FROM connections WHERE file_name = ?').get(DB_FILE)) {
    meta.prepare('INSERT INTO connections (name, file_name, created_at) VALUES (?, ?, ?)')
      .run('Wells Readiness - Plan vs Actual', DB_FILE, new Date().toISOString());
  }
  return { dbPath, rowCount: rows.length };
}

module.exports = { seedWells, PARAMETER_ORDER, TABLE };

if (require.main === module) {
  const { dbPath, rowCount } = seedWells();
  console.log(`Seeded ${rowCount} rows into ${dbPath} (table ${TABLE}).`);
}

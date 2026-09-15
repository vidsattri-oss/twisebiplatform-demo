'use strict';
/**
 * Power BI parity on the real Wells Readiness data (intent success criteria, spec I6).
 * Needs connections/wells.db: WELLS_CSV=<path to export> npm run seed:wells.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CONNECTIONS_DIR } = require('../../connections');
const { getDb: getMetaDb } = require('../../db');
const { openModel } = require('../model');
const { runQuery, runRows } = require('../query');
const { PARAMETER_ORDER, TABLE } = require('../../seed-wells');

const registered = getMetaDb().prepare("SELECT id FROM connections WHERE file_name = 'wells.db'").get();
const seeded = Boolean(registered) && fs.existsSync(path.join(CONNECTIONS_DIR, 'wells.db'));
const skip = seeded ? false : 'Wells data not seeded — run WELLS_CSV=<path> npm run seed:wells to check Power BI parity';

const PARAMETER = { table: TABLE, column: 'Parameter' };
const plant = (name) => ({ kind: 'basic', target: { table: TABLE, column: 'Plant Description' }, operator: 'in', values: [name] });
const byParameter = (extra) => {
  const { model, db } = openModel(registered.id);
  return runQuery(model, db, { groupBy: [PARAMETER], measures: ['Well Count'], filters: [], ...extra });
};
const vector = (res) => {
  const byKey = Object.fromEntries(res.rows.map((r) => [r.keys[0], r.values[0]]));
  return PARAMETER_ORDER.map((p) => byKey[p] ?? 0);
};

test('no filters reproduces the Power BI column chart in Parameter Sort Order', { skip }, () => {
  const res = byParameter();
  assert.deepEqual(res.rows.map((r) => r.keys[0]), PARAMETER_ORDER);
  assert.deepEqual(vector(res), [196, 86, 64, 81, 23, 33, 7, 22, 316, 294]);
});

test('Plant = Marmul ODC matches Power BI', { skip }, () => {
  assert.deepEqual(vector(byParameter({ filters: [plant('Marmul ODC')] })), [134, 59, 43, 65, 0, 14, 6, 21, 197, 179]);
});

test('Planned Completion Date between 2026-01-01 and 2026-06-30 matches Power BI', { skip }, () => {
  const range = { kind: 'range', target: { table: TABLE, column: 'Planned Completion Date (Date)' }, min: '2026-01-01', max: '2026-06-30' };
  assert.deepEqual(vector(byParameter({ filters: [range] })), [61, 0, 0, 0, 0, 0, 0, 19, 236, 216]);
});

test('See records for "Actual - Wells Completed" with Plant = Marmul ODC returns 197 rows', { skip }, () => {
  const { model, db } = openModel(registered.id);
  const point = { kind: 'basic', target: PARAMETER, operator: 'in', values: ['Actual - Wells Completed'] };
  const res = runRows(model, db, { table: TABLE, filters: [plant('Marmul ODC'), point], limit: 100 });
  assert.equal(res.total, 197);
  assert.equal(res.rows.length, 100);
  assert.ok(!res.columns.some((c) => c.name === 'Parameter Sort Order'), 'hidden sort column stays out of See records');
});

test('selecting a bar highlights it and keeps all 10 bars on the source visual', { skip }, () => {
  const res = byParameter({ highlight: [{ kind: 'basic', target: PARAMETER, operator: 'in', values: ['Actual - Wells Completed'] }] });
  assert.equal(res.rows.length, 10);
  assert.deepEqual(res.rows.filter((r) => r.highlights[0] > 0).map((r) => [r.keys[0], r.highlights[0]]), [['Actual - Wells Completed', 316]]);
});

test('query latency p95 stays under 300 ms over 50 runs', { skip }, () => {
  const timings = [];
  for (let i = 0; i < 50; i++) {
    const start = process.hrtime.bigint();
    byParameter({ filters: [plant(i % 2 ? 'Marmul ODC' : 'Nimr ODC')], highlight: [{ kind: 'basic', target: PARAMETER, operator: 'in', values: ['Wells Suspended'] }] });
    timings.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95) - 1];
  assert.ok(p95 < 300, `p95 was ${p95.toFixed(1)} ms`);
});

'use strict';
/** Filters requirements v2: dataset filters (L1), relative date presets and units (L3), relative time and datetime (L4), boolean (L5). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { buildModel, dataTypeOf } = require('../model');
const { runQuery, runRows, runValues, relativeRange } = require('../query');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE logs (id INTEGER PRIMARY KEY, site TEXT, logged_at DATETIME, day DATE, ok BOOLEAN);
    INSERT INTO logs (site, logged_at, day, ok) VALUES
      ('A', '2026-09-15 08:00:00', '2026-09-15', 1),
      ('A', '2026-09-15 11:30:00', '2026-09-15', 0),
      ('B', '2026-09-14 23:00:00', '2026-09-14', 1),
      ('B', '2026-09-10 09:00:00', '2026-09-10', NULL);
  `);
  const model = buildModel({ id: 1, name: 'Logs', db, overlay: { measures: [{ table: 'logs', name: 'Count', expression: 'COUNTROWS(logs)' }] } });
  return { db, model };
}
const target = (column) => ({ table: 'logs', column });
const count = (ctx, filters, extra = {}) => runQuery(ctx.model, ctx.db, { groupBy: [], measures: ['Count'], filters, ...extra }).rows[0].values[0];

test('DATETIME and TIMESTAMP columns are datetime; DATE stays date', () => {
  assert.equal(dataTypeOf('DATETIME'), 'datetime');
  assert.equal(dataTypeOf('TIMESTAMP'), 'datetime');
  assert.equal(dataTypeOf('DATE'), 'date');
});

test('relative date presets: Today, Yesterday, last 7 days with and without today, this week and quarter, next 2 weeks', () => {
  const asOf = '2026-09-15'; // a Tuesday
  const r = (f) => relativeRange(f, asOf);
  assert.deepEqual(r({ period: 'this', count: 1, unit: 'day' }), ['2026-09-15', '2026-09-15']);
  assert.deepEqual(r({ period: 'last', count: 1, unit: 'day', includeToday: false }), ['2026-09-14', '2026-09-14']);
  assert.deepEqual(r({ period: 'last', count: 7, unit: 'day' }), ['2026-09-09', '2026-09-15']);
  assert.deepEqual(r({ period: 'last', count: 7, unit: 'day', includeToday: false }), ['2026-09-08', '2026-09-14']);
  assert.deepEqual(r({ period: 'this', count: 1, unit: 'week' }), ['2026-09-14', '2026-09-20']);
  assert.deepEqual(r({ period: 'this', count: 1, unit: 'quarter' }), ['2026-07-01', '2026-09-30']);
  assert.deepEqual(r({ period: 'next', count: 2, unit: 'week', includeToday: false }), ['2026-09-16', '2026-09-29']);
  assert.throws(() => r({ period: 'last', count: 1, unit: 'day', includeToday: 'no' }), /includeToday must be true or false/);
});

test('a relative date filter on a datetime column includes every time on the last day', () => {
  const ctx = fixture();
  assert.equal(count(ctx, [{ kind: 'relativeDate', target: target('logged_at'), period: 'this', count: 1, unit: 'day' }], { asOf: '2026-09-15' }), 2);
  assert.equal(count(ctx, [{ kind: 'relativeDate', target: target('logged_at'), period: 'last', count: 1, unit: 'day', includeToday: false }], { asOf: '2026-09-15' }), 1);
});

test('relative time filters count back from a UTC "now"', () => {
  const ctx = fixture();
  const rel = (period, n, unit) => count(ctx, [{ kind: 'relativeTime', target: target('logged_at'), period, count: n, unit }], { asOf: '2026-09-15T12:00:00' });
  assert.equal(rel('last', 4, 'hour'), 2);
  assert.equal(rel('last', 45, 'minute'), 1);
  assert.equal(rel('last', 14, 'hour'), 3);
  assert.equal(rel('next', 1, 'hour'), 0);
  assert.throws(() => count(ctx, [{ kind: 'relativeTime', target: target('day'), period: 'last', count: 1, unit: 'hour' }]), /need a date-time column/);
});

test('datetime filter values accept the ISO "T" form and are bound in stored form', () => {
  const ctx = fixture();
  assert.equal(count(ctx, [{ kind: 'range', target: target('logged_at'), min: '2026-09-14T22:00' }]), 3);
  assert.throws(() => count(ctx, [{ kind: 'range', target: target('logged_at'), min: '14/09/2026 22:00' }]), /use YYYY-MM-DD HH:MM:SS/);
  const months = runQuery(ctx.model, ctx.db, { groupBy: [{ table: 'logs', column: 'logged_at', dateLevel: 'month' }], measures: ['Count'], filters: [] });
  assert.deepEqual(months.rows.map((row) => [row.keys[0], row.values[0]]), [['2026-09', 4]]);
});

test('boolean filters match true and false', () => {
  const ctx = fixture();
  const bool = (values) => count(ctx, [{ kind: 'basic', target: target('ok'), operator: 'in', values }]);
  assert.equal(bool([true]), 2);
  assert.equal(bool([false]), 1);
  assert.equal(bool([null]), 1);
});

test('dataset filters apply to queries, rows and slicer values, and a report filter cannot undo them (I10)', () => {
  const ctx = fixture();
  ctx.model.datasetFilters = [{ kind: 'basic', target: target('site'), operator: 'in', values: ['A'] }];
  assert.equal(count(ctx, []), 2);
  assert.equal(count(ctx, [{ kind: 'basic', target: target('site'), operator: 'in', values: ['B'] }]), 0);
  assert.equal(runRows(ctx.model, ctx.db, { table: 'logs', filters: [] }).total, 2);
  assert.deepEqual(runValues(ctx.model, ctx.db, { target: target('site'), filters: [] }).values, ['A']);
  const res = runQuery(ctx.model, ctx.db, { groupBy: [], measures: ['Count'], filters: [{ kind: 'basic', target: target('site'), operator: 'in', values: ['A', 'B'] }] });
  assert.deepEqual(res.ignoredFilters, [], 'dataset filters never show up as ignored report filters');
});

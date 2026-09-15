'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { buildModel } = require('../model');
const { runQuery, runRows, runValues, relativeRange } = require('../query');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE crews (id INTEGER PRIMARY KEY, name TEXT, region TEXT, sort_order INTEGER);
    CREATE TABLE equipment (id INTEGER PRIMARY KEY, crew_id INTEGER REFERENCES crews(id), type TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, crew_id INTEGER REFERENCES crews(id), equipment_id INTEGER REFERENCES equipment(id),
                        status TEXT, qty REAL, task_date DATE, done BOOLEAN);
    CREATE TABLE codes (code TEXT);
    INSERT INTO crews VALUES (1, 'Crew B', 'South', 2), (2, 'Crew A', 'North', 1);
    INSERT INTO equipment VALUES (1, 1, 'Loader'), (2, 2, 'Crane');
    INSERT INTO tasks VALUES
      (1, 1, 1, 'Active', 5, '2026-01-10', 1),
      (2, 1, 1, 'Done',   3, '2026-02-20', 0),
      (3, 2, 2, 'Active', 7, '2026-03-05', 1),
      (4, 2, 2, 'Active', 4, '2025-12-31', 0),
      (5, NULL, NULL, NULL, 2, NULL, NULL);
    INSERT INTO codes VALUES ('x');
  `);
  const model = buildModel({
    id: 1,
    name: 'Fixture',
    db,
    overlay: {
      tables: { crews: { columns: { name: { sortBy: 'sort_order' }, sort_order: { hidden: true } } } },
      measures: [
        { table: 'tasks', name: 'Task Count', expression: 'COUNTROWS(tasks)' },
        { table: 'tasks', name: 'Qty', expression: 'SUM(tasks[qty])' },
        { table: 'tasks', name: 'Avg Qty', expression: 'DIVIDE([Qty], [Task Count])' },
        { table: 'crews', name: 'Crew Count', expression: 'COUNTROWS(crews)' },
      ],
    },
  });
  return { db, model };
}

const f = {
  basic: (table, column, values, operator = 'in') => ({ kind: 'basic', target: { table, column }, operator, values }),
};
const total = (ctx, filters, extra = {}) => runQuery(ctx.model, ctx.db, { groupBy: [], measures: ['Task Count'], filters, ...extra }).rows[0].values[0];
const pairs = (res) => res.rows.map((r) => [...r.keys, ...r.values]);

test('groups by a related dimension through the relationship, in sort-by order with blank first', () => {
  const ctx = fixture();
  const res = runQuery(ctx.model, ctx.db, { groupBy: [{ table: 'crews', column: 'name' }], measures: ['Task Count'], filters: [] });
  assert.deepEqual(pairs(res), [[null, 1], ['Crew A', 2], ['Crew B', 2]]);
});

test('basic filters: in and notIn treat null as (Blank) the way Power BI does', () => {
  const ctx = fixture();
  assert.equal(total(ctx, [f.basic('tasks', 'status', ['Active', null])]), 4);
  assert.equal(total(ctx, [f.basic('tasks', 'status', ['Active'], 'notIn')]), 2);
  assert.equal(total(ctx, [f.basic('tasks', 'status', ['Active', null], 'notIn')]), 1);
  assert.equal(total(ctx, [f.basic('tasks', 'status', [])]), 5);
});

test('a dimension filter propagates to the fact table, including multi-hop paths', () => {
  const ctx = fixture();
  assert.equal(total(ctx, [f.basic('crews', 'region', ['North'])]), 2);
  assert.equal(total(ctx, [f.basic('equipment', 'type', ['Crane'])]), 2);
});

test('filters on unreachable tables are skipped and reported, never silently applied or dropped', () => {
  const ctx = fixture();
  const res = runQuery(ctx.model, ctx.db, { groupBy: [], measures: ['Task Count'], filters: [f.basic('codes', 'code', ['x'])] });
  assert.equal(res.rows[0].values[0], 5);
  assert.deepEqual(res.ignoredFilters, [0]);
  // Single direction: a fact filter does not narrow the dimension table.
  const rows = runRows(ctx.model, ctx.db, { table: 'crews', filters: [f.basic('tasks', 'status', ['Done'])] });
  assert.equal(rows.total, 2);
  assert.deepEqual(rows.ignoredFilters, [0]);
});

test('highlight keeps every category of the source visual and marks the selected share (I4)', () => {
  const ctx = fixture();
  const res = runQuery(ctx.model, ctx.db, {
    groupBy: [{ table: 'tasks', column: 'status' }],
    measures: ['Task Count'],
    filters: [],
    highlight: [f.basic('tasks', 'status', ['Active'])],
  });
  assert.deepEqual(res.rows.map((r) => [r.keys[0], r.values[0], r.highlights[0]]), [[null, 1, 0], ['Active', 3, 3], ['Done', 1, 0]]);
});

test('highlight from a related table repeats the bound predicate across nested measures', () => {
  const ctx = fixture();
  const res = runQuery(ctx.model, ctx.db, {
    groupBy: [{ table: 'tasks', column: 'status' }],
    measures: ['Qty', 'Avg Qty'],
    filters: [],
    highlight: [f.basic('crews', 'name', ['Crew A'])],
  });
  const active = res.rows.find((r) => r.keys[0] === 'Active');
  assert.deepEqual(active.values, [16, 16 / 3]);
  assert.deepEqual(active.highlights, [11, 5.5]);
  const done = res.rows.find((r) => r.keys[0] === 'Done');
  assert.deepEqual(done.highlights, [null, null]);
});

test('advanced filters: contains is case-insensitive, isBlank matches nulls, or-logic combines', () => {
  const ctx = fixture();
  const adv = (column, conditions, logic = 'and') => ({ kind: 'advanced', target: { table: 'tasks', column }, logic, conditions });
  assert.equal(total(ctx, [adv('status', [{ operator: 'contains', value: 'act' }])]), 3);
  assert.equal(total(ctx, [adv('status', [{ operator: 'isBlank' }])]), 1);
  assert.equal(total(ctx, [adv('qty', [{ operator: 'gt', value: 4 }, { operator: 'lt', value: 3 }], 'or')]), 3);
  assert.equal(total(ctx, [adv('status', [{ operator: 'startsWith', value: '%' }])]), 0);
});

test('range and relative date filters include their bounds', () => {
  const ctx = fixture();
  assert.equal(total(ctx, [{ kind: 'range', target: { table: 'tasks', column: 'task_date' }, min: '2026-01-01', max: '2026-02-28' }]), 2);
  const rel = (period, count, unit, asOf) => total(ctx, [{ kind: 'relativeDate', target: { table: 'tasks', column: 'task_date' }, period, count, unit }], { asOf });
  assert.equal(rel('last', 1, 'month', '2026-02-25'), 1);
  assert.equal(rel('this', 1, 'year', '2026-02-25'), 3);
  assert.equal(rel('next', 10, 'day', '2026-02-19'), 1);
});

test('relativeRange follows Power BI date arithmetic, clamping month ends', () => {
  assert.deepEqual(relativeRange({ period: 'last', count: 1, unit: 'month' }, '2026-02-25'), ['2026-01-26', '2026-02-25']);
  assert.deepEqual(relativeRange({ period: 'last', count: 1, unit: 'month' }, '2026-03-31'), ['2026-03-01', '2026-03-31']);
  assert.deepEqual(relativeRange({ period: 'this', count: 1, unit: 'month' }, '2026-02-10'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(relativeRange({ period: 'next', count: 1, unit: 'year' }, '2026-09-14'), ['2026-09-14', '2027-09-13']);
});

test('Top N ranks categories by a measure under the other filters and skips blanks', () => {
  const ctx = fixture();
  const topCrew = (direction, filters = []) =>
    pairs(runQuery(ctx.model, ctx.db, {
      groupBy: [{ table: 'crews', column: 'name' }],
      measures: ['Task Count'],
      filters: [...filters, { kind: 'topN', target: { table: 'crews', column: 'name' }, n: 1, by: 'Qty', direction }],
    }));
  assert.deepEqual(topCrew('top'), [['Crew A', 2]]);
  assert.deepEqual(topCrew('bottom'), [['Crew B', 2]]);
  assert.deepEqual(topCrew('top', [f.basic('tasks', 'status', ['Done'])]), [['Crew B', 1]]);
});

test('date levels group by year, quarter and month', () => {
  const ctx = fixture();
  const level = (dateLevel) => pairs(runQuery(ctx.model, ctx.db, { groupBy: [{ table: 'tasks', column: 'task_date', dateLevel }], measures: ['Task Count'], filters: [] }));
  assert.deepEqual(level('year'), [[null, 1], ['2025', 1], ['2026', 3]]);
  assert.deepEqual(level('quarter'), [[null, 1], ['2025-Q4', 1], ['2026-Q1', 3]]);
  assert.deepEqual(level('month').map((p) => p[0]), [null, '2025-12', '2026-01', '2026-02', '2026-03']);
});

test('orders by measure when asked', () => {
  const ctx = fixture();
  const res = runQuery(ctx.model, ctx.db, { groupBy: [{ table: 'crews', column: 'name' }], measures: ['Qty'], filters: [], orderBy: { by: 'measure', index: 0, direction: 'desc' } });
  assert.deepEqual(pairs(res), [['Crew A', 11], ['Crew B', 8], [null, 2]]);
});

test('filter values must match the column type (I2)', () => {
  const ctx = fixture();
  assert.throws(() => total(ctx, [f.basic('tasks', 'qty', ['abc'])]), /isn't a valid number/);
  assert.throws(() => total(ctx, [{ kind: 'range', target: { table: 'tasks', column: 'task_date' }, min: '14/02/2026' }]), /use YYYY-MM-DD/);
  assert.equal(total(ctx, [f.basic('tasks', 'done', [true])]), 2);
  assert.equal(total(ctx, [f.basic('tasks', 'qty', ['5'])]), 1);
});

test('unknown identifiers and injection attempts are rejected before SQL is built (I1)', () => {
  const ctx = fixture();
  assert.throws(() => total(ctx, [f.basic('tasks', 'status" OR 1=1 --', ['x'])]), /Unknown column/);
  assert.throws(() => total(ctx, [f.basic('tasks; DROP TABLE crews', 'status', ['x'])]), /Unknown table/);
  assert.throws(() => runQuery(ctx.model, ctx.db, { groupBy: [], measures: ['x'], filters: [] }), /Unknown measure/);
  assert.throws(() => total(ctx, [{ kind: 'sql', target: { table: 'tasks', column: 'status' } }]), /Unknown filter kind/);
  assert.equal(total(ctx, [f.basic('tasks', 'status', ["Active' OR '1'='1"])]), 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM crews').get().c, 2);
});

test('rejects measures from different home tables and unreachable group-by tables', () => {
  const ctx = fixture();
  assert.throws(() => runQuery(ctx.model, ctx.db, { groupBy: [], measures: ['Task Count', 'Crew Count'], filters: [] }), /share a home table/);
  assert.throws(() => runQuery(ctx.model, ctx.db, { groupBy: [{ table: 'codes', column: 'code' }], measures: ['Task Count'], filters: [] }), /no many-to-one relationship path/);
});

test('rows: columns across related tables, paging, and a total that ignores paging', () => {
  const ctx = fixture();
  const req = {
    columns: [{ table: 'tasks', column: 'id' }, { table: 'crews', column: 'name' }, { table: 'equipment', column: 'type' }],
    filters: [f.basic('crews', 'region', ['North'])],
  };
  const all = runRows(ctx.model, ctx.db, req);
  assert.equal(all.total, 2);
  assert.deepEqual(all.rows, [[3, 'Crew A', 'Crane'], [4, 'Crew A', 'Crane']]);
  const page = runRows(ctx.model, ctx.db, { ...req, offset: 1, limit: 1 });
  assert.deepEqual(page.rows, [[4, 'Crew A', 'Crane']]);
  assert.equal(page.total, 2);
  assert.deepEqual(runRows(ctx.model, ctx.db, { table: 'crews', filters: [] }).columns.map((c) => c.name), ['id', 'name', 'region']);
});

test('See records totals equal the measure for every data point under the same filters (I3)', () => {
  const ctx = fixture();
  const filters = [f.basic('tasks', 'status', ['Active'])];
  const res = runQuery(ctx.model, ctx.db, { groupBy: [{ table: 'crews', column: 'name' }], measures: ['Task Count'], filters });
  for (const row of res.rows) {
    const point = f.basic('crews', 'name', [row.keys[0]]);
    assert.equal(runRows(ctx.model, ctx.db, { table: 'tasks', filters: [...filters, point] }).total, row.values[0], String(row.keys[0]));
  }
});

test('values: cascade under other filters, honour sort-by, search, and report ranges', () => {
  const ctx = fixture();
  assert.deepEqual(runValues(ctx.model, ctx.db, { target: { table: 'tasks', column: 'status' }, filters: [f.basic('crews', 'region', ['North'])] }).values, ['Active']);
  assert.deepEqual(runValues(ctx.model, ctx.db, { target: { table: 'crews', column: 'name' }, filters: [] }).values, ['Crew A', 'Crew B']);
  assert.deepEqual(runValues(ctx.model, ctx.db, { target: { table: 'crews', column: 'name' }, filters: [], search: 'b' }).values, ['Crew B']);
  const dates = runValues(ctx.model, ctx.db, { target: { table: 'tasks', column: 'task_date' }, filters: [] });
  assert.deepEqual([dates.min, dates.max], ['2025-12-31', '2026-03-05']);
});

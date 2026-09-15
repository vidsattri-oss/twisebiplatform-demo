'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ingestJson } = require('../ingest');
const { buildModel } = require('../model');
const { runQuery } = require('../query');

// Same shape as the seeded FLAF / MOC raw events.
const events = [
  {
    task_code: 'FLAF-2026-0142',
    daily_data: {
      date: '2026-02-11',
      completed: true,
      employee_ids: ['EMP-1042', 'EMP-1077', 'EMP-1099'],
      metrics: { actual_hours: 9.5, actual_quantity: 74 },
    },
    approvals: [
      { role: 'Supervisor', name: 'J. Alvarez', approved: true },
      { role: 'QA', name: 'R. Kim', approved: false },
    ],
  },
  {
    task_code: 'MOC-2026-0088',
    daily_data: { date: '2026-02-12', completed: false, employee_ids: ['EMP-2003'], metrics: { actual_hours: 6, actual_quantity: 41 } },
    approvals: [{ role: 'Supervisor', name: 'T. Nakamura', approved: true }],
  },
];

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;

test('records expand into typed columns; lists become child tables', () => {
  const db = new DatabaseSync(':memory:');
  const res = ingestJson(db, { tableName: 'task events', records: events });
  assert.equal(res.written, true);
  const byName = Object.fromEntries(res.tables.map((t) => [t.name, t]));

  assert.deepEqual(byName.json_task_events.columns, [
    { name: 'task_code', dataType: 'text' },
    { name: 'daily_data.date', dataType: 'date' },
    { name: 'daily_data.completed', dataType: 'boolean' },
    { name: 'daily_data.metrics.actual_hours', dataType: 'number' },
    { name: 'daily_data.metrics.actual_quantity', dataType: 'integer' },
  ]);
  assert.equal(byName.json_task_events__approvals.rowCount, 3);
  assert.equal(byName['json_task_events__daily_data_employee_ids'].rowCount, 4);
  assert.deepEqual(byName['json_task_events__daily_data_employee_ids'].columns, [{ name: 'value', dataType: 'text' }]);
  assert.equal(count(db, 'json_task_events'), 2);
});

test('child tables carry a real foreign key, so the model and query engine can use it', () => {
  const db = new DatabaseSync(':memory:');
  ingestJson(db, { tableName: 'task events', records: events });
  const model = buildModel({
    id: 9,
    name: 'Imports',
    db,
    overlay: { measures: [{ table: 'json_task_events__daily_data_employee_ids', name: 'Employees', expression: 'COUNTROWS(json_task_events__daily_data_employee_ids)' }] },
  });
  assert.ok(model.relationships.some((r) => r.fromTable === 'json_task_events__approvals' && r.toTable === 'json_task_events' && r.fromColumn === '_parent_id'));
  const res = runQuery(model, db, { groupBy: [{ table: 'json_task_events', column: 'task_code' }], measures: ['Employees'], filters: [] });
  assert.deepEqual(res.rows.map((r) => [r.keys[0], r.values[0]]), [['FLAF-2026-0142', 3], ['MOC-2026-0088', 1]]);
});

test('a later payload with a new field adds a column instead of failing', () => {
  const db = new DatabaseSync(':memory:');
  ingestJson(db, { tableName: 'events', records: events });
  const res = ingestJson(db, { tableName: 'events', records: { task_code: 'FLAF-2026-0200', crew_size: 6 } });
  assert.deepEqual(res.tables.find((t) => t.name === 'json_events').addedColumns, ['crew_size']);
  assert.equal(count(db, 'json_events'), 3);
});

test('replace mode clears earlier rows in the table and its child tables', () => {
  const db = new DatabaseSync(':memory:');
  ingestJson(db, { tableName: 'events', records: events });
  ingestJson(db, { tableName: 'events', records: events, mode: 'replace' });
  assert.equal(count(db, 'json_events'), 2);
  assert.equal(count(db, 'json_events__approvals'), 3);
});

test('dry run returns the plan and writes nothing', () => {
  const db = new DatabaseSync(':memory:');
  const res = ingestJson(db, { tableName: 'events', records: events, dryRun: true });
  assert.equal(res.written, false);
  assert.equal(res.tables.length, 3);
  assert.equal(res.tables[0].sample.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get().c, 0);
});

test('column names that look like SQL stay data, and bad input is rejected', () => {
  const db = new DatabaseSync(':memory:');
  ingestJson(db, { tableName: 'weird', records: { 'x"); DROP TABLE t; --': 1, _id: 'kept' } });
  const cols = db.prepare('PRAGMA table_info("json_weird")').all().map((c) => c.name);
  assert.deepEqual(cols, ['_id', 'x); DROP TABLE t; --', 'json_id']);
  assert.throws(() => ingestJson(db, { tableName: 'bad', records: [1, 2] }), /array of objects/);
  assert.throws(() => ingestJson(db, { tableName: '***', records: {} }), /Give the table a name/);
  assert.throws(() => ingestJson(db, { tableName: 'bad', records: {}, mode: 'merge' }), /mode must be/);
});

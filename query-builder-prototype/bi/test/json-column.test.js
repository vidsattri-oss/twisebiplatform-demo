'use strict';
/** J1–J2: flattening a JSON text column (task_daily.daily_data) into tables linked to the source rows. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { flattenJsonColumn } = require('../ingest');
const { buildModel } = require('../model');
const { runRows } = require('../query');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE task_daily (id INTEGER PRIMARY KEY, crew TEXT, daily_data TEXT)');
  const insert = db.prepare('INSERT INTO task_daily VALUES (?, ?, ?)');
  insert.run(1, 'Crew A', JSON.stringify({ date: '2026-09-10', completed: true, employee_ids: ['E1', 'E2'], equipment_ids: ['EQ-1'], metrics: { actual_hours: 9.5, actual_quantity: 74 } }));
  insert.run(2, 'Crew B', JSON.stringify({ date: '2026-09-11', completed: false, employee_ids: ['E3'], equipment_ids: [], metrics: { actual_hours: 6, actual_quantity: 41 } }));
  insert.run(3, 'Crew A', 'not json');
  insert.run(4, 'Crew B', null);
  const rows = () => db.prepare('SELECT id AS key, daily_data AS json FROM task_daily').all();
  const flatten = (options) => flattenJsonColumn(db, { table: 'task_daily', column: 'daily_data', keyColumn: 'id', rows: rows(), ...options });
  return { db, flatten };
}

test('a dry run with chosen keys previews linked tables, lists the keys found and reports skipped rows', () => {
  const { flatten } = fixture();
  const result = flatten({ keys: ['employee_ids', 'metrics.actual_hours', 'metrics.actual_quantity', 'completed', 'nope'], dryRun: true });
  assert.equal(result.written, false);
  assert.equal(result.sourceRows, 4);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.missingKeys, ['nope']);
  for (const key of ['date', 'employee_ids', 'equipment_ids', 'metrics.actual_hours']) assert.ok(result.availableKeys.includes(key), key);

  assert.deepEqual(result.tables.map((t) => t.name), ['task_daily__daily_data', 'task_daily__daily_data__employee_ids']);
  const root = result.tables[0];
  assert.deepEqual(root.columns.map((c) => c.name).sort(), ['completed', 'metrics.actual_hours', 'metrics.actual_quantity', 'task_daily_id']);
  assert.equal(root.columns.find((c) => c.name === 'metrics.actual_hours').dataType, 'number');
  assert.equal(root.columns.find((c) => c.name === 'completed').dataType, 'boolean');
});

test('flattened tables link back to the source row, so filters on the source reach list rows', () => {
  const { db, flatten } = fixture();
  const result = flatten({});
  assert.equal(result.written, true);

  const model = buildModel({ id: 1, name: 'AppMaster', db });
  assert.ok(model.relationships.some((r) => r.fromTable === 'task_daily__daily_data' && r.fromColumn === 'task_daily_id' && r.toTable === 'task_daily' && r.toColumn === 'id'));
  assert.ok(model.relationships.some((r) => r.fromTable === 'task_daily__daily_data__employee_ids' && r.toTable === 'task_daily__daily_data'));

  const crewA = { kind: 'basic', target: { table: 'task_daily', column: 'crew' }, operator: 'in', values: ['Crew A'] };
  const employees = runRows(model, db, { table: 'task_daily__daily_data__employee_ids', filters: [crewA] });
  assert.equal(employees.total, 2);
  assert.deepEqual(employees.rows.map((r) => r[employees.columns.findIndex((c) => c.name === 'value')]).sort(), ['E1', 'E2']);
  assert.equal(runRows(model, db, { table: 'task_daily__daily_data__equipment_ids', filters: [] }).total, 1);
});

test('re-flattening replaces rows instead of duplicating them', () => {
  const { db, flatten } = fixture();
  flatten({});
  flatten({});
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM task_daily__daily_data').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM task_daily__daily_data__employee_ids').get().c, 3);
});

test('unusable input is refused with a readable message', () => {
  const { flatten } = fixture();
  assert.throws(() => flatten({ keys: ['nope'] }), /No row of "task_daily"."daily_data" holds a JSON object with any of the chosen keys/);
  assert.throws(() => flatten({ keys: 'employee_ids' }), /keys must be a list/);
});

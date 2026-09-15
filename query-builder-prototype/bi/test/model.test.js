'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { buildModel, dataTypeOf, quoteIdent } = require('../model');

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE crews (id INTEGER PRIMARY KEY, name TEXT, region TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, crew_id INTEGER REFERENCES crews(id), status TEXT,
                        qty REAL, task_date TEXT, done BOOLEAN, sort_key INTEGER);
    INSERT INTO crews (name, region) VALUES ('Crew A', 'North'), ('Crew B', 'South');
    INSERT INTO tasks (crew_id, status, qty, task_date, done, sort_key) VALUES (1, 'Active', 5, '2026-01-02', 1, 2);
  `);
  return db;
}

test('maps declared SQLite types to contract data types', () => {
  assert.equal(dataTypeOf('INTEGER'), 'integer');
  assert.equal(dataTypeOf('REAL'), 'number');
  assert.equal(dataTypeOf('DATE'), 'date');
  assert.equal(dataTypeOf('BOOLEAN'), 'boolean');
  assert.equal(dataTypeOf('TEXT'), 'text');
  assert.equal(dataTypeOf(''), 'text');
});

test('derives tables, row counts, types and relationships from the live schema', () => {
  const model = buildModel({ id: 7, name: 'Fixture', db: fixtureDb() });
  const tasks = model.tables.find((t) => t.name === 'tasks');
  assert.equal(tasks.rowCount, 1);
  assert.equal(tasks.columns.find((c) => c.name === 'qty').dataType, 'number');
  assert.equal(tasks.columns.find((c) => c.name === 'done').dataType, 'boolean');
  assert.deepEqual(model.relationships, [
    { fromTable: 'tasks', fromColumn: 'crew_id', toTable: 'crews', toColumn: 'id', source: 'foreignKey' },
  ]);
});

test('applies overlay type overrides, sort-by, hidden columns and measures', () => {
  const model = buildModel({
    id: 7,
    name: 'Fixture',
    db: fixtureDb(),
    overlay: {
      tables: { tasks: { columns: { task_date: { dataType: 'date' }, status: { sortBy: 'sort_key' }, sort_key: { hidden: true } } } },
      measures: [{ table: 'tasks', name: 'Task Count', expression: 'COUNTROWS(tasks)', format: '#,0' }],
    },
    userMeasures: [{ id: 3, table_name: 'tasks', name: 'Qty', expression: 'SUM(tasks[qty])', format: null }],
  });
  const cols = model.tables.find((t) => t.name === 'tasks').columns;
  assert.equal(cols.find((c) => c.name === 'task_date').dataType, 'date');
  assert.equal(cols.find((c) => c.name === 'status').sortBy, 'sort_key');
  assert.equal(cols.find((c) => c.name === 'sort_key').hidden, true);
  assert.deepEqual(model.measures.map((m) => [m.name, m.origin]), [['Task Count', 'model'], ['Qty', 'user']]);
});

test('rejects an overlay that names a column the schema does not have', () => {
  assert.throws(
    () => buildModel({ id: 7, name: 'Fixture', db: fixtureDb(), overlay: { tables: { tasks: { columns: { nope: { hidden: true } } } } } }),
    /column "tasks"."nope" does not exist/,
  );
  assert.throws(
    () => buildModel({ id: 7, name: 'Fixture', db: fixtureDb(), overlay: { tables: { tasks: { columns: { status: { sortBy: 'region' } } } } } }),
    /sortBy column "region" is not in table "tasks"/,
  );
});

test('excluded tables never appear in the model', () => {
  const model = buildModel({ id: 7, name: 'Fixture', db: fixtureDb(), exclude: new Set(['crews']) });
  assert.deepEqual(model.tables.map((t) => t.name), ['tasks']);
  assert.deepEqual(model.relationships, []);
});

test('quoteIdent doubles embedded quotes', () => {
  assert.equal(quoteIdent('a"b'), '"a""b"');
});

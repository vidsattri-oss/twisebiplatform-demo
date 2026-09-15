'use strict';
/** Regression tests for the independent QA findings of 2026-09-15. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { buildModel } = require('../model');
const { runRows } = require('../query');
const { ingestJson } = require('../ingest');

test('the query path can build a model without scanning every table for row counts', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO big (v) VALUES (\'a\'), (\'b\');');
  const counted = buildModel({ id: 1, name: 'M', db });
  const uncounted = buildModel({ id: 1, name: 'M', db, counts: false });
  assert.equal(counted.tables[0].rowCount, 2);
  assert.equal(uncounted.tables[0].rowCount, null);
  assert.deepEqual(uncounted.tables[0].columns, counted.tables[0].columns);
});

test('See records works on WITHOUT ROWID tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE readings (site TEXT, day TEXT, value REAL, PRIMARY KEY (site, day)) WITHOUT ROWID;
    INSERT INTO readings VALUES ('A', '2026-01-01', 1), ('A', '2026-01-02', 2), ('B', '2026-01-01', 3);
  `);
  const model = buildModel({ id: 1, name: 'M', db });
  const res = runRows(model, db, { table: 'readings', filters: [{ kind: 'basic', target: { table: 'readings', column: 'site' }, operator: 'in', values: ['A'] }] });
  assert.equal(res.total, 2);
  assert.equal(res.rows.length, 2);
});

test('an import named like another import\'s child table cannot write into it', () => {
  const db = new DatabaseSync(':memory:');
  ingestJson(db, { tableName: 'events', records: [{ code: 'E1', approvals: [{ role: 'QA' }, { role: 'Ops' }] }] });
  const other = ingestJson(db, { tableName: 'events__approvals', records: [{ note: 'separate import' }] });
  assert.equal(other.tables[0].name, 'json_events_approvals');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM "json_events__approvals"').get().c, 2);

  ingestJson(db, { tableName: 'events', records: [{ code: 'E2', approvals: [] }], mode: 'replace' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM "json_events_approvals"').get().c, 1, 'replace of "events" leaves the other import alone');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { buildModel } = require('../model');
const { compileExpression, compileMeasure, validateExpression } = require('../dax');

function fixture(measures = []) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE "Well Data" (status TEXT, qty REAL, planned REAL, "Plant Code" TEXT);
    INSERT INTO "Well Data" VALUES ('Active', 8, 10, 'A'), ('Active', 2, 0, 'A'), ('Done', 5, 5, 'B');
    CREATE TABLE other (x REAL);
  `);
  const model = buildModel({ id: 1, name: 'Fixture', db, overlay: { measures } });
  const run = (sql) => db.prepare(`SELECT ${sql} AS v FROM "Well Data"`).get().v;
  return { db, model, run };
}

const T = 'Well Data';

test('COUNTROWS, SUM and arithmetic compile to SQL that evaluates correctly', () => {
  const { model, run } = fixture();
  assert.equal(run(compileExpression(model, T, "COUNTROWS('Well Data')").sql), 3);
  assert.equal(run(compileExpression(model, T, "SUM('Well Data'[qty]) * 2 + 1").sql), 31);
  assert.equal(run(compileExpression(model, T, "-SUM('Well Data'[qty])").sql), -15);
  assert.equal(run(compileExpression(model, T, "DISTINCTCOUNT('Well Data'[Plant Code])").sql), 2);
});

test('division never errors on zero: "/" and DIVIDE return blank, DIVIDE honours an alternate', () => {
  const { model, db } = fixture();
  const perRow = (expr) => db.prepare(`SELECT ${compileExpression(model, T, expr).sql} AS v FROM "Well Data" GROUP BY rowid ORDER BY rowid`).all().map((r) => r.v);
  assert.deepEqual(perRow("SUM('Well Data'[qty]) / SUM('Well Data'[planned])"), [0.8, null, 1]);
  assert.deepEqual(perRow("DIVIDE(SUM('Well Data'[qty]), SUM('Well Data'[planned]), -1)"), [0.8, -1, 1]);
});

test('measure references inline and report their dependencies', () => {
  const { model, run } = fixture([
    { table: T, name: 'Qty', expression: "SUM('Well Data'[qty])" },
    { table: T, name: 'Planned', expression: "SUM('Well Data'[planned])" },
    { table: T, name: 'Ratio', expression: 'DIVIDE([Qty], [Planned])' },
  ]);
  const { sql, measure, dependencies } = compileMeasure(model, 'Ratio');
  assert.equal(measure.table, T);
  assert.deepEqual(dependencies.sort(), ['Planned', 'Qty']);
  assert.equal(run(sql), 1);
});

test('highlight variant aggregates only rows matching the predicate', () => {
  const { model, run } = fixture();
  const ctx = { highlight: `"Well Data"."status" = 'Active'` };
  assert.equal(run(compileExpression(model, T, "COUNTROWS('Well Data')", ctx).sql), 2);
  assert.equal(run(compileExpression(model, T, "SUM('Well Data'[qty])", ctx).sql), 10);
});

test('errors carry the position of the offending token', () => {
  const { model } = fixture();
  const cases = [
    ["CALCULATE(COUNTROWS('Well Data'))", 0, /CALCULATE isn't supported/],
    ["SUM('Well Data'[nope])", 4, /Unknown column "nope"/],
    ["SUM('Well Data'[status])", 4, /numeric column/],
    ["SUM(other[x])", 4, /home table/],
    ["'Well Data'[qty]", 0, /must be inside an aggregation/],
    ["SUM('Well Data'[qty]", 20, /"\)" to close SUM/],
    ["SUM('Well Data'[qty]) 2", 22, /Unexpected text/],
    ['[Missing]', 0, /Unknown measure \[Missing\]/],
  ];
  for (const [expr, position, message] of cases) {
    const r = validateExpression(model, T, expr);
    assert.equal(r.ok, false, expr);
    assert.match(r.error.error, message, expr);
    assert.equal(r.error.position, position, expr);
  }
});

test('rejects injection attempts at the tokenizer', () => {
  const { model } = fixture();
  const r = validateExpression(model, T, "COUNTROWS('Well Data'); DROP TABLE other");
  assert.equal(r.ok, false);
  assert.match(r.error.error, /Unexpected character ";"/);
  const quoted = validateExpression(model, T, `SUM('Well Data'[qty") FROM x --])`);
  assert.equal(quoted.ok, false);
  assert.match(quoted.error.error, /Unknown column/);
});

test('detects measure cycles', () => {
  const { model } = fixture([
    { table: T, name: 'A', expression: '[B] + 1' },
    { table: T, name: 'B', expression: '[A] * 2' },
  ]);
  assert.throws(() => compileMeasure(model, 'A'), /refers to itself: A → B → A/);
});

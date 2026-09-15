'use strict';
/** F1–F6 and I11: logical, text, date and iterator functions, calculated columns and text measures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { buildModel } = require('../model');
const { compileExpression, validateExpression } = require('../dax');
const { runQuery, runRows, runValues } = require('../query');

const NOW = Date.parse('2026-09-15T12:00:00Z');

function fixture(overlay = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT, qty REAL, planned REAL, task_date DATE, logged_at DATETIME, done BOOLEAN, note TEXT);
    INSERT INTO tasks VALUES
      (1, 'Active', 8, 10, '2026-09-01', '2026-09-14 08:30:00', 0, '  pump check '),
      (2, 'Done', 12, 10, '2026-08-15', '2026-09-13 22:00:00', 1, NULL),
      (3, 'Active', 5, 0, NULL, NULL, NULL, 'Valve');
  `);
  const model = buildModel({ id: 1, name: 'Fixture', db, overlay });
  return { db, model };
}

function binder() {
  const values = {};
  let n = 0;
  return { values, bind: (v) => { const key = `b${n++}`; values[key] = v; return `$${key}`; } };
}

/** Evaluates a measure over the whole table. */
function measure({ db, model }, expression, ctx = {}) {
  const b = binder();
  const { sql, dataType } = compileExpression(model, 'tasks', expression, { bind: b.bind, now: NOW, ...ctx });
  return { value: db.prepare(`SELECT ${sql} AS v FROM tasks`).get(b.values).v, dataType };
}

/** Evaluates a row expression (calculated column) for each row, in id order. */
function perRow({ db, model }, expression) {
  const b = binder();
  const { sql, dataType } = compileExpression(model, 'tasks', expression, { bind: b.bind, now: NOW, mode: 'row' });
  return { values: db.prepare(`SELECT ${sql} AS v FROM tasks ORDER BY id`).all(b.values).map((r) => r.v), dataType };
}

test('F1 logical: IF, SWITCH (value and TRUE()), AND / OR / NOT, && and ||, BLANK and ISBLANK', () => {
  const f = fixture();
  assert.deepEqual(measure(f, 'IF(SUM(tasks[qty]) > 20, "High", "Low")'), { value: 'High', dataType: 'text' });
  assert.deepEqual(perRow(f, 'IF(tasks[qty] >= tasks[planned], "Met", "Missed")').values, ['Missed', 'Met', 'Met']);
  assert.deepEqual(perRow(f, 'SWITCH(tasks[status], "Active", 1, "Done", 2, 0)').values, [1, 2, 1]);
  assert.deepEqual(perRow(f, 'SWITCH(TRUE(), tasks[qty] > 10, "big", tasks[qty] > 6, "mid", "small")').values, ['mid', 'big', 'small']);
  assert.deepEqual(perRow(f, 'IF(AND(tasks[qty] > 6, NOT(tasks[done])), 1, 0)').values, [1, 0, 0]);
  assert.deepEqual(perRow(f, 'tasks[qty] > 10 || tasks[status] = "Done"'), { values: [0, 1, 0], dataType: 'boolean' });
  assert.deepEqual(perRow(f, 'tasks[qty] > 6 && OR(tasks[status] = "Active", FALSE())').values, [1, 0, 0]);
  assert.deepEqual(perRow(f, 'ISBLANK(tasks[task_date])').values, [0, 0, 1]);
  assert.deepEqual(perRow(f, 'IF(tasks[planned] = 0, BLANK(), tasks[qty] / tasks[planned])').values, [0.8, 1.2, null]);
});

test('F2 text: &, CONCATENATE, LEFT / RIGHT / MID, LEN, UPPER / LOWER / TRIM and FORMAT', () => {
  const f = fixture();
  assert.deepEqual(perRow(f, 'tasks[status] & " #" & tasks[id]').values, ['Active #1', 'Done #2', 'Active #3']);
  assert.deepEqual(perRow(f, 'UPPER(LEFT(tasks[status], 3))').values, ['ACT', 'DON', 'ACT']);
  assert.deepEqual(perRow(f, 'RIGHT(tasks[status], 2)').values, ['ve', 'ne', 've']);
  assert.deepEqual(perRow(f, 'MID(tasks[status], 2, 3)').values, ['cti', 'one', 'cti']);
  assert.deepEqual(perRow(f, 'LEN(tasks[note])').values, [13, 0, 5]);
  assert.deepEqual(perRow(f, 'TRIM(tasks[note])').values, ['pump check', null, 'Valve']);
  assert.deepEqual(perRow(f, 'CONCATENATE(LOWER(tasks[status]), "!")').values, ['active!', 'done!', 'active!']);
  assert.equal(measure(f, 'FORMAT(DIVIDE(SUM(tasks[qty]), SUM(tasks[planned])), "0.0%")').value, '125.0%');
  assert.equal(measure(f, 'FORMAT(SUM(tasks[qty]) * 1000, "#,0.00")').value, '25,000.00');
  assert.equal(measure(f, 'FORMAT(-1234.5, "#,0.0")').value, '-1,234.5');
  assert.deepEqual(perRow(f, 'FORMAT(tasks[task_date], "dd MMM yyyy")').values, ['01 Sep 2026', '15 Aug 2026', '']);
});

test('I11: text literals are bound parameters, never SQL text', () => {
  const f = fixture();
  const b = binder();
  const { sql } = compileExpression(f.model, 'tasks', `IF(tasks[status] = "x' OR 1=1 --", 1, 0)`, { bind: b.bind, mode: 'row' });
  assert.ok(!sql.includes('1=1'), sql);
  assert.deepEqual(Object.values(b.values), ["x' OR 1=1 --"]);
  assert.deepEqual(f.db.prepare(`SELECT ${sql} AS v FROM tasks`).all(b.values).map((r) => r.v), [0, 0, 0]);
});

test('F3 dates: TODAY, NOW, DATE, YEAR / MONTH / DAY, WEEKDAY, DATEDIFF and EOMONTH', () => {
  const f = fixture();
  assert.deepEqual(measure(f, 'TODAY()'), { value: '2026-09-15', dataType: 'date' });
  assert.deepEqual(perRow(f, 'DATEDIFF(tasks[task_date], TODAY(), DAY)'), { values: [14, 31, null], dataType: 'integer' });
  assert.deepEqual(perRow(f, 'YEAR(tasks[task_date]) * 100 + MONTH(tasks[task_date])').values, [202609, 202608, null]);
  assert.deepEqual(perRow(f, 'DAY(tasks[task_date])').values, [1, 15, null]);
  assert.deepEqual(perRow(f, 'WEEKDAY(tasks[task_date], 2)').values, [2, 6, null]);
  assert.deepEqual(perRow(f, 'EOMONTH(tasks[task_date], 0)').values, ['2026-09-30', '2026-08-31', null]);
  assert.equal(measure(f, 'EOMONTH(DATE(2026, 2, 10), 1)').value, '2026-03-31');
  assert.equal(measure(f, 'DATE(2026, 14, 1)').value, '2027-02-01');
  for (const [interval, expected] of [['DAY', 1], ['MONTH', 1], ['QUARTER', 1], ['YEAR', 1]]) {
    assert.equal(measure(f, `DATEDIFF(DATE(2025, 12, 31), DATE(2026, 1, 1), ${interval})`).value, expected, interval);
  }
  assert.deepEqual(perRow(f, 'DATEDIFF(tasks[logged_at], NOW(), HOUR)').values, [28, 38, null]);
});

test('F4 iterators and COUNTBLANK, including the highlight variant', () => {
  const f = fixture();
  assert.equal(measure(f, 'SUMX(tasks, tasks[qty] - tasks[planned])').value, 5);
  assert.ok(Math.abs(measure(f, 'AVERAGEX(tasks, tasks[qty] * 2)').value - 50 / 3) < 1e-9);
  assert.equal(measure(f, 'MAXX(tasks, LEN(tasks[status]))').value, 6);
  assert.equal(measure(f, 'MINX(tasks, [qty])').value, 5);
  assert.equal(measure(f, 'COUNTX(tasks, tasks[task_date])').value, 2);
  assert.equal(measure(f, 'COUNTBLANK(tasks[note])').value, 1);
  assert.equal(measure(f, 'SUMX(tasks, tasks[qty] - tasks[planned])', { highlight: `"tasks"."status" = 'Active'` }).value, 3);
});

test('F5 calculated columns work in groups, filters, slicer values and measures; types come from the formula', () => {
  const { db, model } = fixture({
    calculatedColumns: [
      { table: 'tasks', name: 'Gap', expression: 'tasks[qty] - tasks[planned]' },
      { table: 'tasks', name: 'Result', expression: 'IF([Gap] >= 0, "Met", "Missed")' },
      { table: 'tasks', name: 'Age', expression: 'DATEDIFF(tasks[task_date], TODAY(), DAY)' },
    ],
    measures: [{ table: 'tasks', name: 'Total Gap', expression: 'SUM(tasks[Gap])' }],
  });
  const columns = model.tables[0].columns;
  assert.equal(columns.find((c) => c.name === 'Gap').dataType, 'number');
  assert.equal(columns.find((c) => c.name === 'Result').dataType, 'text');

  const grouped = runQuery(model, db, { groupBy: [{ table: 'tasks', column: 'Result' }], measures: ['Total Gap'], filters: [] });
  assert.deepEqual(grouped.rows.map((r) => [r.keys[0], r.values[0]]), [['Met', 7], ['Missed', -2]]);

  const met = runRows(model, db, { table: 'tasks', filters: [{ kind: 'basic', target: { table: 'tasks', column: 'Result' }, operator: 'in', values: ['Met'] }] });
  assert.equal(met.total, 2);
  assert.deepEqual(runValues(model, db, { target: { table: 'tasks', column: 'Result' }, filters: [] }).values, ['Met', 'Missed']);

  const ages = runRows(model, db, { columns: [{ table: 'tasks', column: 'Age' }], filters: [], asOf: '2026-09-15' });
  assert.deepEqual(ages.rows.map((r) => r[0]), [14, 31, null]);
});

test('F6 text KPI measures return text through the query API', () => {
  const { db, model } = fixture({
    measures: [
      { table: 'tasks', name: 'Qty', expression: 'SUM(tasks[qty])' },
      { table: 'tasks', name: 'Planned', expression: 'SUM(tasks[planned])' },
      { table: 'tasks', name: 'Ratio', expression: 'DIVIDE([Qty], [Planned])' },
      { table: 'tasks', name: 'KPI', expression: 'IF([Ratio] >= 1.25, "On track", "At risk")' },
    ],
  });
  const result = runQuery(model, db, { groupBy: [{ table: 'tasks', column: 'status' }], measures: ['Ratio', 'KPI'], filters: [] });
  assert.deepEqual(result.columns.map((c) => c.dataType), ['text', 'number', 'text']);
  assert.deepEqual(result.rows.map((r) => r.values), [[1.3, 'On track'], [1.2, 'At risk']]);
});

test('calculated column cycles are reported, not looped', () => {
  const { model } = fixture({
    calculatedColumns: [
      { table: 'tasks', name: 'A', expression: '[B] + 1' },
      { table: 'tasks', name: 'B', expression: '[A] * 2' },
    ],
  });
  assert.match(model.tables[0].columns.find((c) => c.name === 'A').expressionError, /refers to itself/);
});

test('formula errors are readable and positioned', () => {
  const { model } = fixture({ measures: [{ table: 'tasks', name: 'Total', expression: 'SUM(tasks[qty])' }] });
  const cases = [
    ['measure', 'SUM(tasks[qty]) + "x"', 16, /Use & to join text/],
    ['column', 'SUM(tasks[qty])', 0, /can't be used in a calculated column/],
    ['column', '[Total] * 2', 0, /is a measure/],
    ['measure', 'FORMAT(1, "abc")', 10, /FORMAT supports/],
    ['measure', 'DATEDIFF(TODAY(), TODAY(), FORTNIGHT)', 27, /interval/],
    ['column', 'IF(tasks[status], 1, 0)', 3, /true\/false condition/],
    ['column', 'tasks[status] = 1', 14, /Can't compare text with a number/],
    ['measure', 'IF(1, "unterminated)', 6, /Unclosed text/],
    ['measure', 'CALCULATE(COUNTROWS(tasks))', 0, /CALCULATE isn't supported/],
  ];
  for (const [kind, expression, position, message] of cases) {
    const r = validateExpression(model, 'tasks', expression, kind);
    assert.equal(r.ok, false, expression);
    assert.match(r.error.error, message, expression);
    assert.equal(r.error.position, position, expression);
  }
  assert.deepEqual(validateExpression(model, 'tasks', 'LEFT(tasks[status], 2) & "…"', 'column'), { ok: true, dependencies: [], dataType: 'text' });
});

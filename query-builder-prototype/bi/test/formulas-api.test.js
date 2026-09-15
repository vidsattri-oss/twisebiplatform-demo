'use strict';
/** Contract tests for calculated columns, typed validation and formula preview (F5, F6). */
const test = require('node:test');
const assert = require('node:assert/strict');

let base = process.env.BI_BASE_URL;
let server;

test.before(async () => {
  if (base) return;
  const app = require('../../server');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/bi`;
});
test.after(() => server?.close());

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const post = (path, body) => call('POST', path, body);
const operations = async () => (await call('GET', '/models')).body.find((m) => m.fileName === 'data.db');

test('the Operations model has overlay calculated columns and text KPI measures; bookkeeping tables stay hidden', async () => {
  const ops = await operations();
  const { body: model } = await call('GET', `/models/${ops.id}`);
  const tasks = model.tables.find((t) => t.name === 'tasks');
  assert.equal(tasks.columns.find((c) => c.name === 'Delay Days').dataType, 'integer');
  assert.equal(tasks.columns.find((c) => c.name === 'Quantity Status').dataType, 'text');
  assert.ok(!model.tables.some((t) => ['bi_columns', 'bi_dataset_filters', 'bi_measures'].includes(t.name)));

  const kpi = await post('/query', { modelId: ops.id, groupBy: [{ table: 'crews', column: 'name' }], measures: ['Productivity Status', 'Productivity Label'], filters: [] });
  assert.equal(kpi.status, 200);
  assert.deepEqual(kpi.body.columns.slice(1).map((c) => c.dataType), ['text', 'text']);
  assert.ok(kpi.body.rows.every((r) => ['On track', 'At risk'].includes(r.values[0]) && / of plan$/.test(r.values[1])));
});

test('calculated columns: create, filter and delete; duplicates and aggregations are refused', async () => {
  const ops = await operations();
  const name = `Contract Gap ${Date.now()}`;
  const created = await post(`/models/${ops.id}/columns`, { table: 'tasks', name, expression: 'tasks[actual_quantity] - tasks[planned_quantity]', format: '#,0' });
  assert.equal(created.status, 200);
  assert.equal(created.body.dataType, 'number');

  const behind = await post('/rows', {
    modelId: ops.id,
    columns: [{ table: 'tasks', column: name }],
    filters: [{ kind: 'advanced', target: { table: 'tasks', column: name }, logic: 'and', conditions: [{ operator: 'lt', value: 0 }] }],
    limit: 20,
  });
  assert.equal(behind.status, 200);
  assert.ok(behind.body.total > 0 && behind.body.rows.every((r) => r[0] < 0));

  assert.equal((await post(`/models/${ops.id}/columns`, { table: 'tasks', name, expression: '1' })).status, 400);
  const aggregate = await post(`/models/${ops.id}/columns`, { table: 'tasks', name: `${name} x`, expression: 'SUM(tasks[actual_hours])' });
  assert.equal(aggregate.status, 400);
  assert.equal(aggregate.body.position, 0);
  const self = await post(`/models/${ops.id}/columns`, { table: 'tasks', name: `${name} y`, expression: `[${name} y] + 1` });
  assert.equal(self.status, 400);
  assert.match(self.body.error, /refers to itself/);

  assert.equal((await call('DELETE', `/models/${ops.id}/columns/${created.body.id}`)).status, 200);
});

test('validate reports the result type; preview evaluates a measure and samples a column', async () => {
  const ops = await operations();
  const column = await post('/measures/validate', { modelId: ops.id, table: 'tasks', kind: 'column', expression: 'IF(tasks[actual_quantity] >= tasks[planned_quantity], "Met", "Missed")' });
  assert.deepEqual(column.body, { ok: true, dependencies: [], dataType: 'text' });

  const value = await post('/measures/preview', { modelId: ops.id, table: 'tasks', expression: 'IF([Productivity %] >= 0.5, "On track", "At risk")' });
  assert.equal(value.status, 200);
  assert.deepEqual(value.body, { dataType: 'text', value: 'On track' });

  const sample = await post('/measures/preview', { modelId: ops.id, table: 'tasks', kind: 'column', expression: 'UPPER(tasks[status])' });
  assert.equal(sample.status, 200);
  assert.equal(sample.body.sample.rows.length, 5);
  assert.equal(sample.body.sample.columns.at(-1), 'Result');
  assert.ok(sample.body.sample.rows.every((r) => ['ACTIVE', 'COMPLETED'].includes(r.at(-1))));

  const broken = await post('/measures/preview', { modelId: ops.id, table: 'tasks', expression: 'SUM(' });
  assert.equal(broken.status, 400);
});

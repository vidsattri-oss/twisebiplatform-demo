'use strict';
/**
 * Contract tests over HTTP for docs/api/bi-contract.openapi.yaml. They check
 * status codes and response shapes, not implementation details, so the TWise
 * .NET API can run the same suite by setting BI_BASE_URL.
 */
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

async function operationsModel() {
  const { body } = await call('GET', '/models');
  return body.find((m) => m.fileName === 'data.db');
}

test('GET /models lists connected models; GET /models/{id} returns tables, relationships and measures', async () => {
  const { status, body } = await call('GET', '/models');
  assert.equal(status, 200);
  const ops = body.find((m) => m.fileName === 'data.db');
  assert.equal(ops.status, 'connected');

  const model = await call('GET', `/models/${ops.id}`);
  assert.equal(model.status, 200);
  assert.ok(model.body.tables.some((t) => t.name === 'tasks' && t.columns.some((c) => c.name === 'task_date' && c.dataType === 'date')));
  assert.ok(model.body.relationships.some((r) => r.fromTable === 'tasks' && r.toTable === 'crews'));
  assert.ok(model.body.measures.some((m) => m.name === 'Productivity %'));
  assert.ok(!model.body.tables.some((t) => ['connections', 'bi_reports', 'raw_events'].includes(t.name)), 'metadata tables stay hidden');

  assert.equal((await call('GET', '/models/999999')).status, 404);
});

test('POST /query returns keys, values and highlights; bad input is a 400 with a readable error', async () => {
  const ops = await operationsModel();
  const ok = await post('/query', {
    modelId: ops.id,
    groupBy: [{ table: 'crews', column: 'name' }],
    measures: ['Task Count'],
    filters: [],
    highlight: [{ kind: 'basic', target: { table: 'crews', column: 'region' }, operator: 'in', values: ['North'] }],
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), ['columns', 'ignoredFilters', 'ignoredHighlight', 'rows', 'truncated']);
  assert.equal(ok.body.rows.length, 4);
  assert.ok(ok.body.rows.every((r) => Array.isArray(r.keys) && r.highlights.length === 1));
  assert.ok(!('sql' in ok.body), 'SQL is never sent to clients');

  const bad = await post('/query', { modelId: ops.id, groupBy: [], measures: ['Task Count'], filters: [{ kind: 'basic', target: { table: 'tasks', column: 'nope' }, operator: 'in', values: [] }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Unknown column "nope"/);
});

test('POST /rows pages detail rows with a total; POST /values returns slicer values', async () => {
  const ops = await operationsModel();
  const rows = await post('/rows', { modelId: ops.id, table: 'tasks', filters: [], limit: 5 });
  assert.equal(rows.status, 200);
  assert.equal(rows.body.rows.length, 5);
  assert.equal(rows.body.total, 200);

  const values = await post('/values', { modelId: ops.id, target: { table: 'tasks', column: 'status' }, filters: [] });
  assert.equal(values.status, 200);
  assert.deepEqual(values.body.values, ['Active', 'Completed']);
});

test('measures: validate returns positioned errors; create then delete a user measure', async () => {
  const ops = await operationsModel();
  const invalid = await post('/measures/validate', { modelId: ops.id, table: 'tasks', expression: 'CALCULATE(COUNTROWS(tasks))' });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.ok, false);
  assert.equal(invalid.body.error.position, 0);

  const name = `Contract Test ${Date.now()}`;
  const created = await post(`/models/${ops.id}/measures`, { table: 'tasks', name, expression: 'DIVIDE([Actual Hours], [Task Count])', format: '#,0.0' });
  assert.equal(created.status, 200);
  const used = await post('/query', { modelId: ops.id, groupBy: [], measures: [name], filters: [] });
  assert.equal(used.status, 200);
  assert.equal(typeof used.body.rows[0].values[0], 'number');

  const duplicate = await post(`/models/${ops.id}/measures`, { table: 'tasks', name, expression: 'COUNTROWS(tasks)' });
  assert.equal(duplicate.status, 400);
  const broken = await post(`/models/${ops.id}/measures`, { table: 'tasks', name: `${name} 2`, expression: 'SUM(tasks[nope])' });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.position, 4);

  assert.equal((await call('DELETE', `/models/${ops.id}/measures/${created.body.id}`)).status, 200);
});

test('reports: seeded reports exist; definitions are validated against the model; CRUD round-trips', async () => {
  const list = await call('GET', '/reports');
  assert.equal(list.status, 200);
  assert.ok(list.body.some((r) => r.name === 'Operations Overview'));

  const ops = await operationsModel();
  const definition = {
    filters: [],
    pages: [{ id: 'p1', name: 'Page 1', filters: [], visuals: [{ id: 'v1', type: 'column', roles: { category: [{ table: 'tasks', column: 'status' }], values: [{ measure: 'Task Count' }] }, filters: [] }] }],
  };
  const broken = structuredClone(definition);
  broken.pages[0].visuals[0].roles.category[0].column = 'missing';
  assert.equal((await post('/reports', { name: 'Broken', modelId: ops.id, definition: broken })).status, 400);

  const created = await post('/reports', { name: 'Contract report', modelId: ops.id, definition });
  assert.equal(created.status, 200);
  const updated = await call('PUT', `/reports/${created.body.id}`, { name: 'Contract report (renamed)', modelId: ops.id, definition });
  assert.equal(updated.body.name, 'Contract report (renamed)');
  assert.equal((await call('GET', `/reports/${created.body.id}`)).body.definition.pages[0].visuals[0].id, 'v1');
  assert.equal((await call('DELETE', `/reports/${created.body.id}`)).status, 200);
  assert.equal((await call('GET', `/reports/${created.body.id}`)).status, 404);
});

test('connections: available files and the protected metadata connection', async () => {
  assert.ok(Array.isArray((await call('GET', '/connections/available-files')).body));
  const ops = await operationsModel();
  const refused = await call('DELETE', `/connections/${ops.id}`);
  assert.equal(refused.status, 400);
});

test('ingest/json: dry run previews, a real import becomes a queryable model with relationships', async () => {
  const records = [{ code: 'A-1', crew: { name: 'Crew A' }, workers: [{ id: 'E1' }, { id: 'E2' }] }, { code: 'A-2', crew: { name: 'Crew B' }, workers: [{ id: 'E3' }] }];
  const dry = await post('/ingest/json', { tableName: 'contract_test', records, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.written, false);

  const real = await post('/ingest/json', { tableName: 'contract_test', records, mode: 'replace' });
  assert.equal(real.status, 200);
  assert.equal(real.body.written, true);
  const model = await call('GET', `/models/${real.body.connectionId}`);
  assert.ok(model.body.relationships.some((r) => r.fromTable === 'json_contract_test__workers' && r.toTable === 'json_contract_test'));
  const rows = await post('/rows', { modelId: real.body.connectionId, table: 'json_contract_test__workers', filters: [{ kind: 'basic', target: { table: 'json_contract_test', column: 'crew.name' }, operator: 'in', values: ['Crew A'] }] });
  assert.equal(rows.body.total, 2);

  const models = (await call('GET', '/models')).body;
  const operations = models.find((m) => m.fileName === 'data.db');
  assert.equal((await post('/ingest/json', { connectionId: operations.id, tableName: 'x', records: {} })).status, 400);
});

test('HTTP /query p95 stays under 300 ms over 50 requests', async () => {
  const models = (await call('GET', '/models')).body;
  const wells = models.find((m) => m.fileName === 'wells.db');
  const ops = models.find((m) => m.fileName === 'data.db');
  const body = wells
    ? { modelId: wells.id, groupBy: [{ table: 'WellsReadinessPlanVsActual', column: 'Parameter' }], measures: ['Well Count'], filters: [] }
    : { modelId: ops.id, groupBy: [{ table: 'crews', column: 'name' }], measures: ['Productivity %'], filters: [] };
  const timings = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    assert.equal((await post('/query', body)).status, 200);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95) - 1];
  assert.ok(p95 < 300, `p95 was ${p95.toFixed(1)} ms`);
});

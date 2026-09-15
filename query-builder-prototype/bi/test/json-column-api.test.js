'use strict';
/** Contract test for POST /ingest/json-column (J1–J2). */
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

test('ingest/json-column previews keys, flattens into linked tables and refuses bad targets', async () => {
  const records = [
    { code: 'A-1', payload: JSON.stringify({ shift: 'Day', employee_ids: ['E1', 'E2'], metrics: { actual_hours: 9.5 } }) },
    { code: 'A-2', payload: JSON.stringify({ shift: 'Night', employee_ids: ['E3'], metrics: { actual_hours: 6 } }) },
  ];
  const imported = await post('/ingest/json', { tableName: 'json_column_contract', records, mode: 'replace' });
  assert.equal(imported.status, 200);
  const connectionId = imported.body.connectionId;
  const source = { connectionId, table: 'json_json_column_contract', column: 'payload', keyColumn: '_id' };

  const dry = await post('/ingest/json-column', { ...source, keys: ['employee_ids', 'metrics.actual_hours'], dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.written, false);
  assert.ok(dry.body.availableKeys.includes('shift'));
  assert.deepEqual(dry.body.missingKeys, []);

  const real = await post('/ingest/json-column', { ...source, keys: ['employee_ids', 'metrics.actual_hours'] });
  assert.equal(real.status, 200);
  assert.equal(real.body.written, true);

  const model = await call('GET', `/models/${connectionId}`);
  assert.ok(model.body.relationships.some((r) => r.fromTable === 'json_json_column_contract__payload' && r.toTable === 'json_json_column_contract'));
  const rows = await post('/rows', {
    modelId: connectionId,
    table: 'json_json_column_contract__payload__employee_ids',
    filters: [{ kind: 'basic', target: { table: 'json_json_column_contract', column: 'code' }, operator: 'in', values: ['A-1'] }],
  });
  assert.equal(rows.status, 200);
  assert.equal(rows.body.total, 2);

  assert.equal((await post('/ingest/json-column', { ...source, column: 'nope' })).status, 400);
  const operations = (await call('GET', '/models')).body.find((m) => m.fileName === 'data.db');
  assert.equal((await post('/ingest/json-column', { ...source, connectionId: operations.id })).status, 400);
});

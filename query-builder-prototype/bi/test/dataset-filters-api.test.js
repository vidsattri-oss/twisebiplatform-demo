'use strict';
/**
 * HTTP contract for dataset filters. Uses only the Sales model so it cannot race
 * contract.test.js, which counts Operations rows (node --test runs files in parallel).
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
  const res = await fetch(`${base}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

test('PUT validates dataset filters, every query on the model applies them, and [] clears them', async (t) => {
  const sales = (await call('GET', '/models')).body.find((m) => m.fileName === 'sales.db');
  if (!sales) return t.skip('Sales model not connected');
  const dealCount = async () => (await call('POST', '/query', { modelId: sales.id, groupBy: [], measures: ['Deal Count'], filters: [] })).body.rows[0].values[0];

  await call('PUT', `/models/${sales.id}/dataset-filters`, { filters: [] });
  const everything = await dealCount();

  const badColumn = await call('PUT', `/models/${sales.id}/dataset-filters`, { filters: [{ kind: 'basic', target: { table: 'deals', column: 'nope' }, operator: 'in', values: ['x'] }] });
  assert.equal(badColumn.status, 400);
  const badValue = await call('PUT', `/models/${sales.id}/dataset-filters`, { filters: [{ kind: 'range', target: { table: 'deals', column: 'amount' }, min: 'lots' }] });
  assert.equal(badValue.status, 400);

  const wonOnly = [{ kind: 'basic', target: { table: 'deals', column: 'stage' }, operator: 'in', values: ['Closed Won'] }];
  try {
    const saved = await call('PUT', `/models/${sales.id}/dataset-filters`, { filters: wonOnly });
    assert.equal(saved.status, 200);
    assert.deepEqual((await call('GET', `/models/${sales.id}/dataset-filters`)).body, wonOnly);
    assert.deepEqual((await call('GET', `/models/${sales.id}`)).body.datasetFilters, wonOnly);
    const won = await dealCount();
    assert.ok(won > 0 && won < everything, `expected a subset of ${everything}, got ${won}`);
  } finally {
    await call('PUT', `/models/${sales.id}/dataset-filters`, { filters: [] });
  }
  assert.equal(await dealCount(), everything);
});

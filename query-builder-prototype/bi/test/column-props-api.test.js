'use strict';
/** E3: column properties (hide, format, sort by) set from the report editor. */
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

test('hide, format and sort by apply to the model and to slicer value order, and clear back to defaults', async (t) => {
  const ops = (await call('GET', '/models')).body.find((m) => m.fileName === 'data.db');
  const props = (body) => call('PUT', `/models/${ops.id}/columns/properties`, body);
  t.after(async () => {
    await props({ table: 'crews', column: 'name', hidden: null, format: null, sortBy: null });
    await props({ table: 'tasks', column: 'planned_hours', hidden: null, format: null, sortBy: null });
  });

  const hidden = await props({ table: 'tasks', column: 'planned_hours', hidden: true, format: '#,0.0' });
  assert.equal(hidden.status, 200);
  assert.deepEqual([hidden.body.hidden, hidden.body.format], [true, '#,0.0']);

  const model = (await call('GET', `/models/${ops.id}`)).body;
  assert.equal(model.tables.find((x) => x.name === 'tasks').columns.find((c) => c.name === 'planned_hours').hidden, true);
  assert.ok(!model.tables.some((x) => ['bi_column_props', 'bi_report_categories', 'bi_visual_plugins'].includes(x.name)), 'bookkeeping tables stay hidden');

  const sorted = await props({ table: 'crews', column: 'name', sortBy: 'region' });
  assert.equal(sorted.body.sortBy, 'region');
  const values = await call('POST', '/values', { modelId: ops.id, target: { table: 'crews', column: 'name' }, filters: [] });
  assert.deepEqual(values.body.values, ['Crew C', 'Crew A', 'Crew B', 'Crew D'], 'East, North, South, West');

  const cleared = await props({ table: 'tasks', column: 'planned_hours', hidden: null, format: null });
  assert.deepEqual([cleared.body.hidden, cleared.body.format ?? null], [false, null]);

  assert.equal((await props({ table: 'crews', column: 'name', sortBy: 'nope' })).status, 400);
  assert.equal((await props({ table: 'crews', column: 'name', sortBy: 'name' })).status, 400);
  assert.equal((await props({ table: 'crews', column: 'missing', hidden: true })).status, 400);
  assert.equal((await props({ table: 'crews', column: 'name', hidden: 'yes' })).status, 400);
});

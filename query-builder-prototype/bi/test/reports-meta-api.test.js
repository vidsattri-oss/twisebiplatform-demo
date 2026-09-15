'use strict';
/** R2: report categories, description, status, rename / move / publish, duplicate. */
const test = require('node:test');
const assert = require('node:assert/strict');

let base = process.env.BI_BASE_URL;
let server;
const created = [];

test.before(async () => {
  if (base) return;
  const app = require('../../server');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/bi`;
});
test.after(async () => {
  for (const id of created) await call('DELETE', `/reports/${id}`);
  server?.close();
});

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const definition = (visualType = 'column') => ({
  filters: [],
  pages: [{ id: 'p1', name: 'Page 1', filters: [], visuals: [{ id: 'v1', type: visualType, roles: { category: [{ table: 'tasks', column: 'status' }], values: [{ measure: 'Task Count' }] }, filters: [] }] }],
});

test('categories are seeded with a description and colour, and report counts', async () => {
  const { status, body } = await call('GET', '/report-categories');
  assert.equal(status, 200);
  const productivity = body.find((c) => c.name === 'Productivity');
  assert.ok(productivity);
  assert.match(productivity.color, /^#[0-9A-F]{6}$/);
  assert.equal(typeof productivity.reportCount, 'number');
});

test('reports carry category, description and status; PATCH renames, moves and publishes; duplicate makes a draft copy', async () => {
  const ops = (await call('GET', '/models')).body.find((m) => m.fileName === 'data.db');
  const res = await call('POST', '/reports', { name: 'Meta contract report', modelId: ops.id, definition: definition(), category: 'Productivity', description: 'Status counts.' });
  assert.equal(res.status, 200);
  created.push(res.body.id);
  assert.deepEqual([res.body.category, res.body.description, res.body.status], ['Productivity', 'Status counts.', 'draft']);

  const listed = (await call('GET', '/reports')).body.find((r) => r.id === res.body.id);
  assert.deepEqual([listed.category, listed.status, listed.visualTypes], ['Productivity', 'draft', ['column']]);

  const patched = await call('PATCH', `/reports/${res.body.id}`, { name: 'Meta contract report (renamed)', status: 'published', category: 'Operational' });
  assert.equal(patched.status, 200);
  assert.deepEqual([patched.body.name, patched.body.status, patched.body.category, patched.body.description], ['Meta contract report (renamed)', 'published', 'Operational', 'Status counts.']);
  assert.equal(patched.body.definition.pages[0].visuals[0].id, 'v1', 'the definition is untouched');

  assert.equal((await call('PATCH', `/reports/${res.body.id}`, { category: 'No such category' })).status, 400);
  assert.equal((await call('PATCH', `/reports/${res.body.id}`, { status: 'live' })).status, 400);
  assert.equal((await call('PATCH', `/reports/${res.body.id}`, { name: '' })).status, 400);

  const copy = await call('POST', `/reports/${res.body.id}/duplicate`);
  assert.equal(copy.status, 200);
  created.push(copy.body.id);
  assert.deepEqual([copy.body.name, copy.body.status, copy.body.category], ['Meta contract report (renamed) (copy)', 'draft', 'Operational']);

  const full = await call('PUT', `/reports/${res.body.id}`, { name: 'Meta contract report (renamed)', modelId: ops.id, definition: definition('bar') });
  assert.deepEqual([full.body.status, full.body.category], ['published', 'Operational'], 'a full update keeps metadata it does not send');
});

test('saving categories validates names and colours; reports in a removed category become uncategorised', async () => {
  const original = (await call('GET', '/report-categories')).body.map(({ name, description, color }) => ({ name, description, color }));
  const ops = (await call('GET', '/models')).body.find((m) => m.fileName === 'data.db');
  const temporary = `Contract ${Date.now()}`;
  try {
    assert.equal((await call('PUT', '/report-categories', { categories: [...original, { name: temporary, color: 'blue' }] })).status, 400);
    assert.equal((await call('PUT', '/report-categories', { categories: [...original, { name: 'Productivity', color: '#000000' }] })).status, 400);

    const saved = await call('PUT', '/report-categories', { categories: [...original, { name: temporary, description: 'Temporary', color: '#123abc' }] });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.at(-1).color, '#123ABC');

    const report = await call('POST', '/reports', { name: 'Category removal report', modelId: ops.id, definition: definition(), category: temporary });
    created.push(report.body.id);
    await call('PUT', '/report-categories', { categories: original });
    assert.equal((await call('GET', `/reports/${report.body.id}`)).body.category, null);
  } finally {
    await call('PUT', '/report-categories', { categories: original });
  }
});

'use strict';
/** Contract tests for custom visual plug-ins (V1–V3): catalog, install, import validation, removal. */
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
  return { status: res.status, type: res.headers.get('content-type'), body: await res.json() };
}
const post = (path, body) => call('POST', path, body);

test('the catalog offers the sample plug-ins; installing one makes its manifest and code available', async (t) => {
  const catalog = await call('GET', '/visuals/catalog');
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.body.map((c) => c.type), ['bullet-chart', 'heat-map']);
  const wasInstalled = catalog.body.find((c) => c.type === 'heat-map').installed;
  t.after(async () => {
    if (!wasInstalled) await call('DELETE', '/visuals/heat-map');
  });

  const sample = await call('GET', '/visuals/catalog/heat-map');
  assert.equal(sample.body.manifest.label, 'Heat map');
  assert.match(sample.body.code, /bi\.registerVisual\(/);

  const installed = await post('/visuals/catalog/heat-map/install');
  assert.equal(installed.status, 200);
  assert.equal(installed.body.source, 'catalog');
  assert.deepEqual(installed.body.roles.map((r) => [r.name, r.kind, r.max]), [['category', 'grouping', 2], ['values', 'measure', 1]]);

  const list = await call('GET', '/visuals');
  const listed = list.body.find((p) => p.type === 'heat-map');
  assert.ok(listed);
  assert.ok(!('code' in listed), 'the list never carries code');

  const code = await call('GET', '/visuals/heat-map/code');
  assert.match(code.type, /application\/json/, 'code is data, never served as a script');
  assert.match(code.body.code, /registerVisual/);
  assert.equal((await call('GET', '/visuals/catalog')).body.find((c) => c.type === 'heat-map').installed, true);
});

test('imported plug-ins are validated: type, icon, roles and code', async () => {
  const manifest = { type: 'contract-sparkline', label: 'Sparkline', icon: 'M3 17l5-5 4 3 9-9', roles: [{ name: 'category', label: 'Axis' }, { name: 'values', label: 'Value', max: 1 }] };
  const code = 'bi.registerVisual({ render(root) { root.textContent = "ok"; } });';
  const cases = [
    [{ ...manifest, type: 'column' }, code, /built-in visual/],
    [{ ...manifest, type: 'Bad Type' }, code, /lowercase letters/],
    [{ ...manifest, icon: '<script>alert(1)</script>' }, code, /SVG path data/],
    [{ ...manifest, roles: [{ name: 'category' }] }, code, /needs a "values" role/],
    [{ ...manifest, roles: [{ name: 'rows' }, { name: 'values' }] }, code, /named "category"/],
    [{ ...manifest, roles: [{ name: 'values', max: 9 }] }, code, /max ≤ 5/],
    [manifest, 'window.parent.document.cookie', /bi\.registerVisual/],
    [manifest, `bi.registerVisual({}); //${'x'.repeat(210 * 1024)}`, /larger than 200 KB/],
  ];
  for (const [m, c, message] of cases) {
    const res = await post('/visuals', { manifest: m, code: c });
    assert.equal(res.status, 400, String(message));
    assert.match(res.body.error, message);
  }

  const imported = await post('/visuals', { manifest, code });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.source, 'imported');
  assert.equal((await call('DELETE', '/visuals/contract-sparkline')).status, 200);
  assert.equal((await call('GET', '/visuals/contract-sparkline/code')).status, 404);
});

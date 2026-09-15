'use strict';
/** R3: per-user favorites and recent reports on a separate server. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, createStore, MAX_RECENT } = require('../server');

let base;
let server;

test.before(async () => {
  server = createServer({ allowedOrigins: ['http://localhost:4200'] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, pathname, { user = 'satya', body, origin } = {}) => {
  const headers = { ...(user && { 'X-User-Id': user }), ...(body && { 'Content-Type': 'application/json' }), ...(origin && { Origin: origin }) };
  const res = await fetch(`${base}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
};

test('favorites and recent reports are kept per person', async () => {
  assert.deepEqual((await call('GET', '/api/users/me/report-preferences')).body, { favorites: [], recent: [] });

  await call('PUT', '/api/users/me/report-favorites/1', { body: { favorite: true } });
  const both = await call('PUT', '/api/users/me/report-favorites/4', { body: { favorite: true } });
  assert.deepEqual(both.body.favorites, [4, 1]);
  assert.deepEqual((await call('PUT', '/api/users/me/report-favorites/1', { body: { favorite: false } })).body.favorites, [4]);

  await call('POST', '/api/users/me/report-recent', { body: { reportId: 2 } });
  const recent = await call('POST', '/api/users/me/report-recent', { body: { reportId: 5 } });
  assert.deepEqual(recent.body.recent.map((r) => r.reportId), [5, 2]);

  assert.deepEqual((await call('GET', '/api/users/me/report-preferences', { user: 'someone-else' })).body, { favorites: [], recent: [] });
});

test('requests without a valid person or report id are refused; CORS allows only the harness', async () => {
  assert.equal((await call('GET', '/api/users/me/report-preferences', { user: null })).status, 401);
  assert.equal((await call('GET', '/api/users/me/report-preferences', { user: 'bad user!' })).status, 401);
  assert.equal((await call('PUT', '/api/users/me/report-favorites/abc', { body: { favorite: true } })).status, 400);
  assert.equal((await call('PUT', '/api/users/me/report-favorites/3', { body: { favorite: 'yes' } })).status, 400);
  assert.equal((await call('POST', '/api/users/me/report-recent', { body: { reportId: -1 } })).status, 400);

  const allowed = await call('OPTIONS', '/api/users/me/report-preferences', { origin: 'http://localhost:4200' });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:4200');
  const other = await call('GET', '/api/users/me/report-preferences', { origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('recent keeps the last ten distinct reports and the store survives a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-')), 'preferences.json');
  const store = createStore(file);
  for (let id = 1; id <= 12; id++) store.recordOpened('satya', id, `2026-09-15T10:${String(id).padStart(2, '0')}:00Z`);
  store.recordOpened('satya', 3, '2026-09-15T11:00:00Z');
  store.setFavorite('satya', 7, true);

  const reopened = createStore(file).get('satya');
  assert.equal(reopened.recent.length, MAX_RECENT);
  assert.equal(reopened.recent[0].reportId, 3);
  assert.equal(reopened.recent.filter((r) => r.reportId === 3).length, 1);
  assert.deepEqual(reopened.favorites, [7]);
});

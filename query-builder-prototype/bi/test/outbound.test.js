'use strict';
/** I9: the outbound guard — allow list, private addresses, redirects, size and time caps. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseAllowList, matchHost, isPrivateAddress, checkUrl, fetchOutbound } = require('../connectors/outbound');

test('allow list entries match exact hosts, wildcard subdomains and explicit ports', () => {
  const list = parseAllowList('docs.google.com,*.googleusercontent.com,localhost:4173');
  assert.deepEqual(matchHost(new URL('https://docs.google.com/x'), list), { allowed: true, exact: true });
  assert.deepEqual(matchHost(new URL('https://doc-0s.googleusercontent.com/x'), list), { allowed: true, exact: false });
  assert.equal(matchHost(new URL('https://googleusercontent.com.evil.example/x'), list).allowed, false);
  assert.equal(matchHost(new URL('https://docs.google.com:8443/x'), list).allowed, false);
  assert.deepEqual(matchHost(new URL('http://localhost:4173/api'), list), { allowed: true, exact: true });
  assert.equal(matchHost(new URL('http://localhost:9999/api'), list).allowed, false);
});

test('private, loopback and link-local addresses are recognised', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.10', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '142.250.72.14', '2607:f8b0:4005::200e']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('refuses unlisted hosts, http through a wildcard, inline credentials and wildcard hosts that resolve privately', async () => {
  const list = parseAllowList('*.example.com,api.example.org');
  const publicLookup = async () => [{ address: '93.184.216.34' }];
  const privateLookup = async () => [{ address: '10.0.0.5' }];
  await assert.rejects(checkUrl('https://evil.example.net/x', list, publicLookup), /aren't allowed/);
  await assert.rejects(checkUrl('http://data.example.com/x', list, publicLookup), /Use https/);
  await assert.rejects(checkUrl('https://user:pw@data.example.com/x', list, publicLookup), /not in the URL/);
  await assert.rejects(checkUrl('https://data.example.com/x', list, privateLookup), /private address/);
  await assert.rejects(checkUrl('file:///etc/passwd', list, publicLookup), /Only http and https/);
  assert.equal((await checkUrl('https://data.example.com/x', list, publicLookup)).host, 'data.example.com');
});

test('fetches from an exactly listed local host, re-checks redirects and enforces size and time caps', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') return res.end(JSON.stringify([{ a: 1 }]));
    if (req.url === '/hop') return res.writeHead(302, { Location: '/ok' }).end();
    if (req.url === '/away') return res.writeHead(302, { Location: 'https://evil.example/steal' }).end();
    if (req.url === '/big') return res.end('x'.repeat(5000));
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 1000);
    if (req.url === '/auth') return res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const allowList = parseAllowList(`127.0.0.1:${server.address().port}`);

  assert.deepEqual(JSON.parse((await fetchOutbound(`${base}/ok`, { allowList })).body), [{ a: 1 }]);
  assert.deepEqual(JSON.parse((await fetchOutbound(`${base}/hop`, { allowList })).body), [{ a: 1 }]);
  assert.deepEqual(JSON.parse((await fetchOutbound(`${base}/auth`, { allowList, headers: { Authorization: 'Bearer t' } })).body), { auth: 'Bearer t' });
  await assert.rejects(fetchOutbound(`${base}/away`, { allowList }), /evil\.example aren't allowed/);
  await assert.rejects(fetchOutbound(`${base}/big`, { allowList, limits: { bytes: 1000, timeoutMs: 5000, redirects: 3 } }), /sent more than/);
  await assert.rejects(fetchOutbound(`${base}/slow`, { allowList, limits: { bytes: 1000, timeoutMs: 200, redirects: 3 } }), /didn't answer/);
  await assert.rejects(fetchOutbound(`${base}/missing`, { allowList }), /HTTP 404/);
  await assert.rejects(fetchOutbound(`${base}/ok`), /aren't allowed/, 'the default allow list does not include local hosts');
});

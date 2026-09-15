'use strict';
/** Contract tests for typed connections, pulls and uploads (S1–S4, I9). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crewWorkbook } = require('./helpers/xlsx-fixture');

let base;
let port;
let server;
const created = [];

test.before(async () => {
  const app = require('../../server');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  base = `http://127.0.0.1:${port}/api/bi`;
  // Only this test server may be pulled from; the default list has no local hosts.
  process.env.BI_OUTBOUND_ALLOWED_HOSTS = `127.0.0.1:${port}`;
});
test.after(async () => {
  for (const id of created) await call('DELETE', `/connections/${id}`);
  server?.close();
});

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json(), text: '' };
}
const post = (path, body) => call('POST', path, body);
const connection = async (id) => (await call('GET', '/connections')).body.find((c) => c.id === id);

test('connection types are listed, with whether each database driver is installed', async () => {
  const { status, body } = await call('GET', '/connections/types');
  assert.equal(status, 200);
  assert.deepEqual(body.map((t) => t.type), ['sqlite', 'csv', 'excel', 'rest', 'googleSheet', 'sap', 'sqlServer', 'postgres']);
  const sqlServer = body.find((t) => t.type === 'sqlServer');
  assert.equal(sqlServer.driver, 'mssql');
  assert.equal(typeof sqlServer.driverInstalled, 'boolean');
});

test('a SQL Server connection says what it needs and never returns its secret', async () => {
  const secret = 'fixture-password-never-returned';
  const res = await post('/connections', { name: 'AppMasterDB (contract)', type: 'sqlServer', settings: { host: 'appmaster.internal', database: 'AppMasterDB', user: 'bi_reader' }, secret });
  assert.equal(res.status, 200);
  created.push(res.body.id);

  const list = await call('GET', '/connections');
  assert.ok(!JSON.stringify(list.body).includes(secret), 'the secret is never sent to clients');
  const row = list.body.find((c) => c.id === res.body.id);
  assert.equal(row.state, 'needs-setup');
  assert.equal(row.hasSecret, true);
  assert.match(row.needs, /Needs SQL Server: tables to copy/);

  const tested = await post(`/connections/${res.body.id}/test`);
  assert.equal(tested.body.ok, false);
  assert.match(tested.body.needs, /tables to copy/);
  assert.equal((await post(`/connections/${res.body.id}/refresh`)).status, 400);

  assert.equal((await call('PUT', `/connections/${res.body.id}`, { settings: { tables: 'dbo.task_daily' } })).status, 200);
  const withTables = await post(`/connections/${res.body.id}/test`);
  assert.equal(withTables.body.ok, false);
  const types = (await call('GET', '/connections/types')).body;
  if (!types.find((t) => t.type === 'sqlServer').driverInstalled) {
    assert.match(withTables.body.needs, /install the "mssql" package/);
    assert.match((await connection(res.body.id)).needs, /install the "mssql" package/);
  }
});

test('a REST connection pulls the sample feed through the allow list into related, queryable tables', async () => {
  const refused = await post('/connections', { name: 'Not allowed', type: 'rest', settings: { url: 'https://example.com/feed.json' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /aren't allowed/);

  const res = await post('/connections', {
    name: 'Work orders feed (contract)',
    type: 'rest',
    settings: { url: `http://127.0.0.1:${port}/api/bi/samples/work-orders.json`, tableName: 'work_orders' },
  });
  assert.equal(res.status, 200);
  created.push(res.body.id);
  assert.equal((await connection(res.body.id)).state, 'needs-refresh');

  const tested = await post(`/connections/${res.body.id}/test`);
  assert.equal(tested.body.ok, true);
  assert.match(tested.body.message, /30 record/);

  const refreshed = await post(`/connections/${res.body.id}/refresh`);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.rows, 30);
  assert.deepEqual(refreshed.body.tables.sort(), ['work_orders', 'work_orders__approvals']);

  const model = await call('GET', `/models/${res.body.id}`);
  assert.ok(model.body.relationships.some((r) => r.fromTable === 'work_orders__approvals' && r.toTable === 'work_orders'));
  const flaf = await post('/rows', { modelId: res.body.id, table: 'work_orders', filters: [{ kind: 'basic', target: { table: 'work_orders', column: 'doc_type' }, operator: 'in', values: ['FLAF'] }] });
  assert.equal(flaf.body.total, 6);

  const row = await connection(res.body.id);
  assert.equal(row.state, 'ready');
  assert.equal(row.rowCount, 30);
  assert.ok(row.lastRefresh);
  assert.equal((await post('/ingest/csv', { connectionId: res.body.id, tableName: 'x', csv: 'a\n1' })).status, 400, 'uploads never go into a pulled connection');
});

test('CSV and Excel uploads land typed tables', async () => {
  const csv = 'crew,hours,date,code\nCrew A,9.5,2026-09-14,0042\nCrew B,6,2026-09-13,0107\n';
  const dry = await post('/ingest/csv', { tableName: 'crew_hours_contract', csv, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.written, false);
  const csvResult = await post('/ingest/csv', { tableName: 'crew_hours_contract', csv });
  assert.equal(csvResult.status, 200);
  const csvModel = await call('GET', `/models/${csvResult.body.connectionId}`);
  const csvColumns = csvModel.body.tables.find((t) => t.name === 'crew_hours_contract').columns;
  const csvType = (name) => csvColumns.find((c) => c.name === name).dataType;
  assert.deepEqual([csvType('hours'), csvType('date'), csvType('code')], ['number', 'date', 'text']);

  const excel = await post('/ingest/excel', { fileName: 'crew contract.xlsx', fileBase64: crewWorkbook().toString('base64') });
  assert.equal(excel.status, 200);
  assert.deepEqual(excel.body.sheets, ['Tasks', 'Empty']);
  assert.deepEqual(excel.body.emptySheets, ['Empty']);
  assert.equal(excel.body.tables[0].name, 'crew_contract_Tasks');
  assert.equal(excel.body.tables[0].rowCount, 2);
  const excelModel = await call('GET', `/models/${excel.body.connectionId}`);
  const excelColumns = excelModel.body.tables.find((t) => t.name === 'crew_contract_Tasks').columns;
  assert.equal(excelColumns.find((c) => c.name === 'Hours').dataType, 'number');
  assert.equal(excelColumns.find((c) => c.name === 'Done').dataType, 'boolean');

  assert.equal((await post('/ingest/excel', { fileName: 'x.xlsx', fileBase64: Buffer.from('not a workbook').toString('base64') })).status, 400);
});

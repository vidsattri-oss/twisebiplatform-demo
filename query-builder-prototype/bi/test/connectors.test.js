'use strict';
/** S3–S4: Google link handling, record envelopes, and database connectors against mocked drivers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { googleDownloadUrl, recordsAt, landTables, normalizeSettings, connectionInfo } = require('../connectors');
const { snapshotDatabase, testDatabase } = require('../connectors/database');
const { buildModel } = require('../model');

test('Google Sheets and Drive share links become direct download links', () => {
  assert.equal(
    googleDownloadUrl('https://docs.google.com/spreadsheets/d/1AbC-d_E/edit#gid=42'),
    'https://docs.google.com/spreadsheets/d/1AbC-d_E/export?format=csv&gid=42',
  );
  assert.equal(
    googleDownloadUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vT/pubhtml?gid=7', 'xlsx'),
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vT/pub?output=xlsx&gid=7',
  );
  assert.equal(googleDownloadUrl('https://drive.google.com/file/d/0B7xyz/view?usp=sharing'), 'https://drive.google.com/uc?export=download&id=0B7xyz');
  assert.equal(googleDownloadUrl('https://drive.google.com/open?id=0B7xyz'), 'https://drive.google.com/uc?export=download&id=0B7xyz');
});

test('records come from a path or a common envelope', () => {
  assert.deepEqual(recordsAt({ data: { items: [{ a: 1 }] } }, 'data.items'), [{ a: 1 }]);
  assert.deepEqual(recordsAt({ value: [{ a: 1 }] }), [{ a: 1 }]);
  assert.deepEqual(recordsAt({ d: { results: [{ a: 2 }] } }), [{ a: 2 }]);
  assert.throws(() => recordsAt({ data: [] }, 'data.missing'), /Nothing was found at "data.missing"/);
});

test('a database connection without settings or a secret says exactly what it needs', () => {
  const settings = normalizeSettings('sqlServer', { host: 'appmaster.internal' });
  const info = connectionInfo({ type: 'sqlServer', settings_json: JSON.stringify(settings), credentials_enc: null });
  assert.equal(info.state, 'needs-setup');
  assert.equal(info.needs, 'Needs SQL Server: database, user, password, tables to copy (schema.table).');
  assert.equal(info.hasSecret, false);
  assert.ok(!('credentials_enc' in info));
});

function fakeMssql(log, rows) {
  return {
    connect: async (config) => {
      log.config = config;
      return {
        request: () => ({
          query: async (sql) => {
            log.sql.push(sql);
            if (sql.includes('INFORMATION_SCHEMA')) return { recordset: [{ table_schema: 'dbo', table_name: 'TaskDaily' }, { table_schema: 'sap', table_name: 'PurchaseOrders' }] };
            return { recordset: rows };
          },
        }),
        close: async () => { log.closed = true; },
      };
    },
  };
}

test('SQL Server snapshot: tables are matched against INFORMATION_SCHEMA before quoting, and rows land with their types', async () => {
  const log = { sql: [] };
  const rows = [
    { id: 1, crew: 'Crew A', logged_at: new Date('2026-09-14T08:30:00Z'), work_date: new Date('2026-09-14T00:00:00Z'), completed: true, daily_data: '{"employee_ids":["E1"]}' },
    { id: 2, crew: 'Crew B', logged_at: new Date('2026-09-13T22:00:00Z'), work_date: new Date('2026-09-13T00:00:00Z'), completed: false, daily_data: null },
  ];
  const config = { host: 'appmaster.internal', port: 1433, database: 'AppMasterDB', user: 'bi_reader', password: 'fixture-password' };
  const tables = await snapshotDatabase('sqlServer', config, ['DBO.taskdaily'], { drivers: { mssql: fakeMssql(log, rows) }, maxRows: 500 });

  assert.equal(log.config.server, 'appmaster.internal');
  assert.equal(log.config.options.encrypt, true);
  assert.deepEqual(log.sql, [log.sql[0], 'SELECT TOP (500) * FROM [dbo].[TaskDaily]']);
  assert.equal(log.closed, true);
  assert.equal(tables[0].name, 'dbo_TaskDaily');

  const db = new DatabaseSync(':memory:');
  const landed = landTables(db, tables);
  assert.equal(landed.rows, 2);
  const columns = buildModel({ id: 1, name: 'AppMasterDB', db }).tables.find((t) => t.name === 'dbo_TaskDaily').columns;
  const type = (name) => columns.find((c) => c.name === name).dataType;
  assert.deepEqual([type('logged_at'), type('work_date'), type('completed'), type('id')], ['datetime', 'date', 'boolean', 'integer']);
  assert.equal(db.prepare('SELECT logged_at FROM dbo_TaskDaily WHERE id = 1').get().logged_at, '2026-09-14 08:30:00');

  landTables(db, tables);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dbo_TaskDaily').get().c, 2, 'a refresh replaces rows');
});

test('SQL Server snapshot refuses a table the database does not list, without sending its name', async () => {
  const log = { sql: [] };
  const attack = 'dbo.TaskDaily]; DROP TABLE dbo.TaskDaily; --';
  await assert.rejects(snapshotDatabase('sqlServer', { host: 'h' }, [attack], { drivers: { mssql: fakeMssql(log, []) } }), /wasn't found on SQL Server/);
  assert.ok(log.sql.every((sql) => !sql.includes('DROP')));
  assert.equal(log.closed, true);
});

test('PostgreSQL quotes with double quotes and LIMIT; a missing driver reports what to install', async () => {
  const sent = [];
  class Client {
    constructor(config) { this.config = config; }
    async connect() {}
    async query(sql) {
      sent.push(sql);
      return { rows: sql.includes('INFORMATION_SCHEMA') ? [{ table_schema: 'public', table_name: 'work_orders' }] : [{ order_no: 'PO-1' }] };
    }
    async end() {}
  }
  const tables = await snapshotDatabase('postgres', { host: 'db.cloud', password: 'x' }, ['public.work_orders'], { drivers: { pg: { Client } }, maxRows: 10 });
  assert.equal(sent[1], 'SELECT * FROM "public"."work_orders" LIMIT 10');
  assert.deepEqual(tables, [{ name: 'public_work_orders', records: [{ order_no: 'PO-1' }] }]);

  await assert.rejects(testDatabase('sqlServer', { host: 'h' }, { mssql: null }), (e) => e.needs === true && /install the "mssql" package/.test(e.message));
});

test('driver connection errors never echo the password', async () => {
  const mssql = { connect: async (c) => { throw new Error(`Login failed for user with password ${c.password}`); } };
  await assert.rejects(testDatabase('sqlServer', { host: 'h', password: 'fixture-secret' }, { mssql }), (e) => !e.message.includes('fixture-secret') && /\*\*\*/.test(e.message));
});

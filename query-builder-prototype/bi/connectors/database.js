'use strict';

/**
 * Database connectors (spec S4): SQL Server (AppMasterDB) and PostgreSQL-
 * compatible cloud databases, in import mode — a refresh copies each chosen
 * table into the connection's SQLite file, which the model reads like any
 * other source. Drivers are optional: "mssql" and "pg" load only if installed
 * on the server; without one the connection says what is needed. Tests pass
 * mocked drivers.
 *
 * Table names are matched against the database's own INFORMATION_SCHEMA before
 * they are quoted into SQL — the remote equivalent of invariant I1.
 */

const { BiError } = require('../errors');

/** An error that means "set something up" rather than "something broke". */
const needs = (message) => Object.assign(new BiError(400, message), { needs: true });

function loadDriver(name) {
  try {
    return require(name);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') return null;
    throw e;
  }
}

const LIST_TABLES = "SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')";

const ADAPTERS = {
  sqlServer: {
    driver: 'mssql',
    system: 'SQL Server',
    quote: (part) => `[${part.replace(/]/g, ']]')}]`,
    selectAll: (ref, max) => `SELECT TOP (${max}) * FROM ${ref}`,
    async connect(mssql, cfg) {
      const pool = await mssql.connect({
        server: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.user,
        password: cfg.password,
        options: { encrypt: cfg.encrypt !== false, trustServerCertificate: cfg.trustServerCertificate === true },
        connectionTimeout: 15000,
        requestTimeout: 60000,
      });
      return { query: async (sql) => (await pool.request().query(sql)).recordset, close: () => pool.close() };
    },
  },
  postgres: {
    driver: 'pg',
    system: 'PostgreSQL',
    quote: (part) => `"${part.replace(/"/g, '""')}"`,
    selectAll: (ref, max) => `SELECT * FROM ${ref} LIMIT ${max}`,
    async connect(pg, cfg) {
      const client = new pg.Client({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.user,
        password: cfg.password,
        ssl: cfg.encrypt === false ? false : { rejectUnauthorized: cfg.trustServerCertificate !== true },
        connectionTimeoutMillis: 15000,
        statement_timeout: 60000,
      });
      await client.connect();
      return { query: async (sql) => (await client.query(sql)).rows, close: () => client.end() };
    },
  },
};

/** Driver values as SQLite-friendly scalars: dates as ISO text, big integers as numbers, JSON objects as text, binary dropped. */
function toScalar(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'bigint') return Number(value);
  if (Buffer.isBuffer(value)) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

async function withClient(type, config, drivers = {}) {
  const adapter = ADAPTERS[type];
  const driver = adapter.driver in drivers ? drivers[adapter.driver] : loadDriver(adapter.driver);
  if (!driver) throw needs(`Needs ${adapter.system}: install the "${adapter.driver}" package on the BI server (npm install ${adapter.driver}), then test again.`);
  try {
    return { adapter, client: await adapter.connect(driver, config) };
  } catch (e) {
    const reason = String(e?.message ?? e);
    throw new BiError(400, `Couldn't connect to ${adapter.system} at ${config.host}: ${config.password ? reason.split(config.password).join('***') : reason}`);
  }
}

async function testDatabase(type, config, drivers) {
  const { client } = await withClient(type, config, drivers);
  try {
    const tables = await client.query(LIST_TABLES);
    return { ok: true, message: `Connected. ${tables.length} tables and views are visible.`, tables: tables.map((t) => `${t.table_schema}.${t.table_name}`).slice(0, 500) };
  } finally {
    await client.close();
  }
}

/** Reads each chosen "schema.table" (matched case-insensitively against INFORMATION_SCHEMA) as records. */
async function snapshotDatabase(type, config, tables, { drivers, maxRows = 50000 } = {}) {
  const { adapter, client } = await withClient(type, config, drivers);
  try {
    const available = await client.query(LIST_TABLES);
    const results = [];
    for (const wanted of tables) {
      const match = available.find((t) => `${t.table_schema}.${t.table_name}`.toLowerCase() === String(wanted).toLowerCase());
      if (!match) throw new BiError(400, `Table "${wanted}" wasn't found on ${adapter.system}. Write it as schema.table, e.g. dbo.task_daily.`);
      const ref = `${adapter.quote(match.table_schema)}.${adapter.quote(match.table_name)}`;
      const rows = await client.query(adapter.selectAll(ref, maxRows));
      results.push({
        name: `${match.table_schema}_${match.table_name}`,
        records: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toScalar(v)]))),
      });
    }
    return results;
  } finally {
    await client.close();
  }
}

module.exports = { ADAPTERS, LIST_TABLES, loadDriver, testDatabase, snapshotDatabase, toScalar };

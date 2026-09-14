const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const CONNECTIONS_DIR = path.join(__dirname, 'connections');
const ROOT_DB_PATH = path.join(__dirname, 'data.db');
const ROOT_DB_FILE = 'data.db';

// Metadata tables that live alongside real data in data.db but are never
// themselves queryable through the generic query engine.
const INTERNAL_TABLES = new Set(['connections', 'measures', 'dashboards', 'dashboard_charts']);

const dbHandles = new Map(); // connection id -> DatabaseSync

/**
 * Resolves a bare file name to an absolute path INSIDE connections/, or to
 * the built-in root data.db. Never accepts a path with directory
 * separators or ".." — a connection can only ever point at a file this
 * server already knows about, not an arbitrary path supplied by a client.
 */
function resolveFilePath(fileName) {
  if (fileName === ROOT_DB_FILE) return ROOT_DB_PATH;
  const base = path.basename(fileName);
  if (base !== fileName || fileName.includes('..')) {
    throw new Error(`Invalid connection file name "${fileName}"`);
  }
  const full = path.join(CONNECTIONS_DIR, base);
  if (!fs.existsSync(full)) {
    throw new Error(`"${fileName}" was not found in the connections directory`);
  }
  return full;
}

function getDb(connectionId, fileName) {
  if (dbHandles.has(connectionId)) return dbHandles.get(connectionId);
  const filePath = resolveFilePath(fileName);
  const db = new DatabaseSync(filePath);
  dbHandles.set(connectionId, db);
  return db;
}

function getFilePath(connectionId, fileName) {
  return resolveFilePath(fileName);
}

/** Lists .db files sitting in connections/ that aren't registered yet — the "+ Add Connection" picker's source list. */
function listAvailableFiles(registeredFileNames) {
  if (!fs.existsSync(CONNECTIONS_DIR)) fs.mkdirSync(CONNECTIONS_DIR, { recursive: true });
  const registered = new Set(registeredFileNames);
  return fs.readdirSync(CONNECTIONS_DIR).filter((f) => f.endsWith('.db') && !registered.has(f));
}

/** Real tables in a connection's database — schema-derived, not hardcoded, so a newly added DB just works. */
function getQueryableTables(connectionId, fileName) {
  const db = getDb(connectionId, fileName);
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const exclude = fileName === ROOT_DB_FILE ? INTERNAL_TABLES : new Set();
  return rows.map((r) => r.name).filter((n) => !exclude.has(n));
}

/** ATTACHes a second connection's file onto a primary connection's handle under a fixed alias, for cross-DB joins. */
function ensureAttached(primaryDb, joinFilePath) {
  const attached = primaryDb.prepare('PRAGMA database_list').all();
  const existing = attached.find((a) => a.name === 'joined');
  if (existing) {
    if (path.resolve(existing.file || '') === path.resolve(joinFilePath)) return;
    primaryDb.exec('DETACH DATABASE joined');
  }
  const escaped = joinFilePath.replace(/'/g, "''");
  primaryDb.exec(`ATTACH DATABASE '${escaped}' AS joined`);
}

module.exports = {
  CONNECTIONS_DIR,
  ROOT_DB_FILE,
  getDb,
  getFilePath,
  listAvailableFiles,
  getQueryableTables,
  ensureAttached,
};

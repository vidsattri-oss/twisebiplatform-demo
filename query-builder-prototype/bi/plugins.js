'use strict';

/**
 * Custom visual plug-ins (spec V1–V3). A plug-in is a manifest (type, label,
 * icon, fields) plus one JavaScript file that calls
 * bi.registerVisual({ render(root, data, api) }).
 *
 * The server stores and validates plug-ins but never runs their code and never
 * serves it as a script: clients fetch it as JSON text and run it only inside a
 * sandboxed iframe with no network access (invariant I8).
 */

const fs = require('fs');
const path = require('path');
const { getDb: getMetaDb } = require('../db');
const { badRequest, notFound } = require('./errors');

const CATALOG_DIR = path.join(__dirname, 'plugin-catalog');
const BUILT_IN_TYPES = new Set(['column', 'bar', 'line', 'pie', 'donut', 'card', 'table', 'slicer']);
const LIMITS = { code: 200 * 1024, manifest: 16 * 1024 };

function ensurePluginSchema(meta = getMetaDb()) {
  meta.exec(`
    CREATE TABLE IF NOT EXISTS bi_visual_plugins (
      type TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      code TEXT NOT NULL,
      source TEXT NOT NULL,
      installed_at TEXT NOT NULL
    );
  `);
}

function text(value, label, max, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`The manifest needs ${label}.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max) throw badRequest(`${label} must be text of at most ${max} characters.`);
  return value;
}

/** Plug-ins draw query results, so their fields use the report's aggregate roles: "category" (group by) and "values" (measures). */
function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw badRequest('The manifest must be a JSON object.');
  if (Buffer.byteLength(JSON.stringify(m)) > LIMITS.manifest) throw badRequest('The manifest is larger than 16 KB.');
  if (typeof m.type !== 'string' || !/^[a-z][a-z0-9-]{2,40}$/.test(m.type)) {
    throw badRequest('type must be 3 to 41 lowercase letters, digits or dashes, starting with a letter, e.g. "bullet-chart".');
  }
  if (BUILT_IN_TYPES.has(m.type)) throw badRequest(`"${m.type}" is a built-in visual; choose another type.`);
  const label = text(m.label, 'a label', 60, true);
  const icon = m.icon ?? 'M4 4h16v16H4z';
  if (typeof icon !== 'string' || icon.length > 1000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(icon)) {
    throw badRequest('icon must be SVG path data for a 24 × 24 box, e.g. "M4 20V10M12 20V4".');
  }
  if (!Array.isArray(m.roles) || !m.roles.length || m.roles.length > 2) throw badRequest('roles must list a "values" role, and optionally a "category" role.');
  const roles = m.roles.map((r) => {
    if (!r || (r.name !== 'category' && r.name !== 'values')) throw badRequest('Each role is named "category" (fields to group by) or "values" (measures).');
    const grouping = r.name === 'category';
    const limit = grouping ? 2 : 5;
    const min = r.min ?? 1;
    const max = r.max ?? 1;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max || max > limit) {
      throw badRequest(`Role "${r.name}" needs whole numbers with 0 ≤ min ≤ max ≤ ${limit}.`);
    }
    return { name: r.name, label: text(r.label ?? (grouping ? 'Category' : 'Values'), `role "${r.name}" label`, 40, true), kind: grouping ? 'grouping' : 'measure', min, max };
  });
  if (new Set(roles.map((r) => r.name)).size !== roles.length) throw badRequest('Each role can appear only once.');
  if (!roles.some((r) => r.name === 'values')) throw badRequest('A plug-in needs a "values" role: it draws measures.');
  return {
    type: m.type,
    label,
    icon,
    roles,
    description: text(m.description, 'description', 300),
    version: text(m.version, 'version', 20),
    author: text(m.author, 'author', 80),
  };
}

function validateCode(code) {
  if (typeof code !== 'string' || !code.trim()) throw badRequest('Send the plug-in’s JavaScript as text.');
  if (Buffer.byteLength(code) > LIMITS.code) throw badRequest('The plug-in code is larger than 200 KB.');
  if (!/registerVisual\s*\(/.test(code)) throw badRequest('The code must call bi.registerVisual({ render(root, data, api) { … } }).');
  return code;
}

/** Bundled sample plug-ins: <type>.json manifests with <type>.js code. */
function catalog() {
  return fs.readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, file), 'utf8')));
      return { manifest, code: fs.readFileSync(path.join(CATALOG_DIR, `${manifest.type}.js`), 'utf8') };
    });
}

function listPlugins() {
  ensurePluginSchema();
  return getMetaDb()
    .prepare('SELECT type, manifest_json, source, installed_at FROM bi_visual_plugins ORDER BY type')
    .all()
    .map((r) => ({ ...JSON.parse(r.manifest_json), source: r.source, installedAt: r.installed_at }));
}

function catalogEntries() {
  const installed = new Set(listPlugins().map((p) => p.type));
  return catalog().map(({ manifest }) => ({ ...manifest, installed: installed.has(manifest.type) }));
}

function catalogPackage(type) {
  const entry = catalog().find((e) => e.manifest.type === type);
  if (!entry) throw notFound(`The catalog has no visual "${type}".`);
  return entry;
}

function savePlugin(manifestInput, codeInput, source) {
  const manifest = validateManifest(manifestInput);
  const code = validateCode(codeInput);
  ensurePluginSchema();
  const installedAt = new Date().toISOString();
  getMetaDb()
    .prepare(`INSERT INTO bi_visual_plugins (type, manifest_json, code, source, installed_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(type) DO UPDATE SET manifest_json = excluded.manifest_json, code = excluded.code, source = excluded.source, installed_at = excluded.installed_at`)
    .run(manifest.type, JSON.stringify(manifest), code, source, installedAt);
  return { ...manifest, source, installedAt };
}

function installFromCatalog(type) {
  const { manifest, code } = catalogPackage(type);
  return savePlugin(manifest, code, 'catalog');
}

function pluginCode(type) {
  ensurePluginSchema();
  const row = getMetaDb().prepare('SELECT code FROM bi_visual_plugins WHERE type = ?').get(type);
  if (!row) throw notFound(`No installed visual "${type}".`);
  return { code: row.code };
}

function removePlugin(type) {
  ensurePluginSchema();
  getMetaDb().prepare('DELETE FROM bi_visual_plugins WHERE type = ?').run(type);
  return { ok: true };
}

module.exports = { ensurePluginSchema, validateManifest, listPlugins, catalogEntries, catalogPackage, savePlugin, installFromCatalog, pluginCode, removePlugin };

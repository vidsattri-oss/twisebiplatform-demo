'use strict';

/**
 * A local stand-in for TWise's user service (spec R3, option 2): each person's
 * favorite reports and recently opened reports, kept on a server rather than in
 * the browser. It runs on its own port with its own store, the way @tasnim/bi
 * calls TWise's user API in production.
 *
 * The demo identifies the person with an X-User-Id header. TWise identifies
 * them from its sign-in instead; nothing else changes.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MAX_RECENT = 10;
const MAX_BODY_BYTES = 1024;
const USER_ID = /^[A-Za-z0-9._@-]{1,64}$/;
const DEFAULT_ORIGINS = ['http://localhost:4200'];

/** File-backed store; with no file it lives in memory (tests). Writes go to a temp file, then rename. */
function createStore(file) {
  let data = { users: {} };
  if (file && fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      data = { users: {} };
    }
  }
  const save = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  };
  const user = (id) => {
    if (!data.users[id]) data.users[id] = { favorites: [], recent: [] };
    return data.users[id];
  };
  const snapshot = (id) => {
    const u = data.users[id] ?? { favorites: [], recent: [] };
    return { favorites: [...u.favorites], recent: u.recent.map((r) => ({ ...r })) };
  };
  return {
    get: snapshot,
    setFavorite(id, reportId, favorite) {
      const u = user(id);
      u.favorites = u.favorites.filter((r) => r !== reportId);
      if (favorite) u.favorites.unshift(reportId);
      save();
      return snapshot(id);
    },
    recordOpened(id, reportId, openedAt = new Date().toISOString()) {
      const u = user(id);
      u.recent = [{ reportId, openedAt }, ...u.recent.filter((r) => r.reportId !== reportId)].slice(0, MAX_RECENT);
      save();
      return snapshot(id);
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('The request body is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Send a JSON body.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const reportIdOf = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw Object.assign(new Error('reportId must be a report id.'), { status: 400 });
  return n;
};

function createServer({ file = null, allowedOrigins = DEFAULT_ORIGINS } = {}) {
  const store = createStore(file);
  const origins = new Set(allowedOrigins);

  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (origins.has(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return send(200, { ok: true });
      if (!url.pathname.startsWith('/api/users/me/')) return send(404, { error: 'Not found.' });

      const userId = req.headers['x-user-id'];
      if (typeof userId !== 'string' || !USER_ID.test(userId)) return send(401, { error: 'Send the person as an X-User-Id header (letters, digits, . _ @ -).' });

      if (req.method === 'GET' && url.pathname === '/api/users/me/report-preferences') {
        return send(200, store.get(userId));
      }
      const favorite = /^\/api\/users\/me\/report-favorites\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'PUT' && favorite) {
        const body = await readBody(req);
        if (typeof body.favorite !== 'boolean') return send(400, { error: 'favorite must be true or false.' });
        return send(200, store.setFavorite(userId, reportIdOf(favorite[1]), body.favorite));
      }
      if (req.method === 'POST' && url.pathname === '/api/users/me/report-recent') {
        const body = await readBody(req);
        return send(200, store.recordOpened(userId, reportIdOf(body.reportId)));
      }
      return send(404, { error: 'Not found.' });
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500) console.error(e);
      return send(status, { error: status >= 500 ? 'Something went wrong on the preferences server.' : e.message });
    }
  });
}

module.exports = { createServer, createStore, MAX_RECENT };

if (require.main === module) {
  const port = Number(process.env.PORT) || 4175;
  const file = process.env.PREFERENCES_FILE || path.join(__dirname, 'data', 'preferences.json');
  createServer({ file }).listen(port, () => {
    console.log(`Preferences server (TWise user service stand-in) on http://localhost:${port} — store: ${file}`);
  });
}

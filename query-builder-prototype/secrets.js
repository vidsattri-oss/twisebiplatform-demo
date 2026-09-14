const crypto = require('crypto');

/**
 * Envelope encryption for connection credentials (item 01's "connection
 * should be stored securely" requirement). SQLite files don't need a
 * password, so nothing in this demo actually stores a secret yet — but
 * the moment a real networked source (SQL Server, Postgres) is added,
 * its connection string/password goes through encrypt() before it ever
 * reaches the `connections` table, and decrypt() only ever runs
 * server-side to open the connection. The plaintext never round-trips
 * to the client — GET /api/connections always redacts credentials_enc.
 */
const ALGO = 'aes-256-gcm';

function loadKey() {
  const keyHex = process.env.CONNECTION_SECRET_KEY;
  if (keyHex) {
    const buf = Buffer.from(keyHex, 'hex');
    if (buf.length !== 32) throw new Error('CONNECTION_SECRET_KEY must be 32 bytes (64 hex chars)');
    return buf;
  }
  // Dev-only fallback: an ephemeral key generated at process start. This is
  // NOT persisted, so anything encrypted with it is unreadable after a
  // restart — intentional, so a missing real key fails loudly (as
  // unreadable secrets) rather than silently using a weak default.
  console.warn(
    '[secrets] CONNECTION_SECRET_KEY not set in the environment — using an ephemeral ' +
    'per-process key. Fine for this local demo; set a real 32-byte key (see .env.example) ' +
    'before storing anything that must survive a restart.',
  );
  return crypto.randomBytes(32);
}

const KEY = loadKey();

function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payloadB64) {
  const buf = Buffer.from(payloadB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };

'use strict';

/**
 * Outbound HTTP for pull connectors (spec S3), guarded against SSRF (invariant I9):
 * - only hosts on BI_OUTBOUND_ALLOWED_HOSTS (comma list, e.g. "docs.google.com,
 *   *.googleusercontent.com,localhost:4173"); an entry without a port matches the
 *   default port only;
 * - https, unless the host is listed exactly (not through a wildcard);
 * - hosts resolving to private, loopback or link-local addresses are refused
 *   unless listed exactly;
 * - redirects are followed by hand and every hop is checked again; credentials
 *   are only sent to the original origin;
 * - a timeout and a response size cap.
 * Credentials are added here, on the server, and never returned to clients.
 */

const dns = require('node:dns').promises;
const net = require('node:net');
const { badRequest } = require('../errors');

const DEFAULT_ALLOWED_HOSTS = 'docs.google.com,drive.google.com,drive.usercontent.google.com,*.googleusercontent.com';
const LIMITS = { bytes: 10 * 1024 * 1024, timeoutMs: 15000, redirects: 3 };

function parseAllowList(value = process.env.BI_OUTBOUND_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS) {
  return String(value)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const wildcard = entry.startsWith('*.');
      const [host, port] = (wildcard ? entry.slice(2) : entry).split(':');
      return { host, port: port ?? '', wildcard };
    });
}

/** { allowed, exact }: exact means listed by name, which also permits http and private addresses. */
function matchHost(url, allowList) {
  const host = url.hostname.toLowerCase();
  for (const entry of allowList) {
    if (entry.port !== url.port) continue;
    if (!entry.wildcard && host === entry.host) return { allowed: true, exact: true };
    if (entry.wildcard && host.endsWith(`.${entry.host}`)) return { allowed: true, exact: false };
  }
  return { allowed: false, exact: false };
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:') && net.isIPv4(v6.slice(7))) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** The synchronous checks: a valid URL, no inline credentials, an allowed host and scheme. */
function assertAllowedUrl(raw, allowList = parseAllowList()) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest(`"${raw}" isn't a valid URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Only http and https URLs can be pulled.');
  if (url.username || url.password) throw badRequest('Put credentials in the connection’s secret, not in the URL.');
  const match = matchHost(url, allowList);
  if (!match.allowed) throw badRequest(`Requests to ${url.host} aren't allowed. Add it to BI_OUTBOUND_ALLOWED_HOSTS on the BI server.`);
  if (url.protocol === 'http:' && !match.exact) throw badRequest(`Use https for ${url.host}; plain http is only allowed for hosts listed exactly.`);
  return { url, exact: match.exact };
}

async function checkUrl(raw, allowList, lookup = dns.lookup) {
  const { url, exact } = assertAllowedUrl(raw, allowList);
  if (!exact) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    if (net.isIP(host)) addresses = [{ address: host }];
    else {
      try {
        addresses = await lookup(host, { all: true });
      } catch {
        throw badRequest(`${host} couldn't be resolved.`);
      }
    }
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      throw badRequest(`${host} resolves to a private address. List it exactly in BI_OUTBOUND_ALLOWED_HOSTS if that is intended.`);
    }
  }
  return url;
}

async function readCapped(res, max, host) {
  const tooBig = () => badRequest(`${host} sent more than ${Math.round(max / 1048576)} MB.`);
  if (Number(res.headers.get('content-length')) > max) throw tooBig();
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > max) throw tooBig();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * GET a URL through the guard. Returns { contentType, body (Buffer), url }.
 * Options exist for tests: allowList, lookup, fetchImpl, limits.
 */
async function fetchOutbound(raw, { headers = {}, allowList = parseAllowList(), lookup, fetchImpl = fetch, limits = LIMITS } = {}) {
  const origin = new URL(raw).origin;
  let current = raw;
  for (let hop = 0; hop <= limits.redirects; hop++) {
    const url = await checkUrl(current, allowList, lookup);
    let res;
    try {
      res = await fetchImpl(url, {
        headers: url.origin === origin ? headers : {},
        redirect: 'manual',
        signal: AbortSignal.timeout(limits.timeoutMs),
      });
    } catch (e) {
      throw badRequest(e?.name === 'TimeoutError' ? `${url.host} didn't answer within ${limits.timeoutMs / 1000} seconds.` : `${url.host} couldn't be reached.`);
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw badRequest(`${url.host} answered HTTP ${res.status}${res.status === 401 || res.status === 403 ? '; check the connection’s secret or sharing settings' : ''}.`);
    }
    return { contentType: res.headers.get('content-type') ?? '', body: await readCapped(res, limits.bytes, url.host), url: url.toString() };
  }
  throw badRequest(`Too many redirects from ${new URL(raw).host}.`);
}

module.exports = { DEFAULT_ALLOWED_HOSTS, LIMITS, parseAllowList, matchHost, isPrivateAddress, assertAllowedUrl, checkUrl, fetchOutbound };

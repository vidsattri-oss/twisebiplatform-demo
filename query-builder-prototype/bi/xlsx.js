'use strict';

/**
 * Dependency-free .xlsx reader (spec S2; no new runtime dependency). Reads the
 * zip central directory, inflates parts with node:zlib and parses the workbook,
 * shared strings, styles (to recognise date formats) and each worksheet.
 * Handles shared, inline and formula strings, booleans, numbers and
 * date-formatted serials. Refuses ZIP64, password-protected and oversized
 * files rather than guessing.
 */

const zlib = require('node:zlib');
const { badRequest } = require('./errors');

const LIMITS = { bytes: 15 * 1024 * 1024, unzipped: 150 * 1024 * 1024, rows: 200000, columns: 500 };
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function readZip(buf) {
  const entries = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw badRequest("That file isn't an Excel workbook (.xlsx).");
  const count = buf.readUInt16LE(eocd + 10);
  const offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw badRequest('Workbooks this large (ZIP64) aren’t supported; save a smaller file.');

  let p = offset;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw badRequest('The workbook is damaged (its zip directory is unreadable).');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw badRequest('Password-protected workbooks can’t be read; save an unprotected copy.');
    total += uncompressed;
    if (total > LIMITS.unzipped) throw badRequest('The workbook unpacks to more than 150 MB.');
    entries.set(name, { method, compressed, local });
  }

  return {
    text(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw badRequest('The workbook is damaged (a zip entry is unreadable).');
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.compressed);
      if (e.method === 0) return data.toString('utf8');
      if (e.method !== 8) throw badRequest(`The workbook uses an unsupported compression method (${e.method}).`);
      try {
        return zlib.inflateRawSync(data, { maxOutputLength: LIMITS.unzipped }).toString('utf8');
      } catch {
        throw badRequest(`The workbook is damaged (${name} can't be unpacked).`);
      }
    },
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (m, hex, dec, named) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[named.toLowerCase()]);
const attrs = (source) => Object.fromEntries([...source.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
/** The text of every <t> run, ignoring phonetic hints. */
const textOf = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

/** Indexes (into cellXfs) of cell styles whose number format shows a date or time. */
function dateStyles(xml) {
  if (!xml) return new Set();
  const custom = new Map([...xml.matchAll(/<numFmt\b[^>]*>/g)].map((m) => {
    const a = attrs(m[0]);
    return [Number(a.numFmtId), a.formatCode ?? ''];
  }));
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const dates = new Set();
  [...cellXfs.matchAll(/<xf\b[^>]*>/g)].forEach((m, index) => {
    const id = Number(attrs(m[0]).numFmtId ?? 0);
    const code = custom.get(id);
    // Quoted text, [colour]/[locale] sections and escaped characters don't make a format a date.
    if (BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')))) dates.add(index);
  });
  return dates;
}

/** Excel serial (1900 date system) to "YYYY-MM-DD", or "YYYY-MM-DD HH:MM:SS" when it has a time. */
function serialToIso(serial) {
  const iso = new Date(Math.round((serial - 25569) * 86400000)).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

function columnIndex(ref) {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheet(xml, shared, dates, sheetName) {
  const rows = [];
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const index = Number(attrs(row[1]).r ?? rows.length + 1) - 1;
    if (index >= LIMITS.rows) throw badRequest(`Sheet "${sheetName}" has more than ${LIMITS.rows.toLocaleString('en-US')} rows.`);
    const cells = [];
    for (const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cell[1]);
      const inner = cell[2] ?? '';
      const col = a.r ? columnIndex(a.r) : cells.length;
      if (col >= LIMITS.columns) throw badRequest(`Sheet "${sheetName}" has more than ${LIMITS.columns} columns.`);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = null;
      switch (a.t) {
        case 's': value = v === undefined ? null : (shared[Number(v)] ?? null); break;
        case 'inlineStr': value = textOf(inner); break;
        case 'str': value = v === undefined ? null : decode(v); break;
        case 'b': value = v === undefined ? null : v === '1'; break;
        case 'e': value = null; break;
        case 'd': value = v === undefined ? null : decode(v); break;
        default:
          if (v !== undefined && v !== '') {
            const number = Number(v);
            value = dates.has(Number(a.s ?? 0)) ? serialToIso(number) : number;
          }
      }
      cells[col] = value;
    }
    rows[index] = cells;
  }
  return rows;
}

/** Every sheet as { name, rows }, rows being arrays of cell values (sparse positions are undefined). */
function readXlsx(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw badRequest('Send the workbook file.');
  if (buffer.length > LIMITS.bytes) throw badRequest('The workbook is larger than 15 MB.');
  const zip = readZip(buffer);
  const workbook = zip.text('xl/workbook.xml');
  if (!workbook) throw badRequest("That file isn't an Excel workbook (.xlsx): it has no xl/workbook.xml.");
  const rels = new Map([...(zip.text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const a = attrs(m[0]);
    return [a.Id, a.Target];
  }));
  const shared = [...(zip.text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const dates = dateStyles(zip.text('xl/styles.xml'));
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const a = attrs(m[0]);
    const target = rels.get(a['r:id']) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = target ? zip.text(path) : null;
    return { name: a.name ?? 'Sheet', rows: xml ? readSheet(xml, shared, dates, a.name) : [] };
  });
}

/**
 * One record list per sheet: the first non-empty row is the header (blank
 * headers become "Column N", repeats get a number); empty rows are dropped.
 */
function workbookTables(buffer) {
  return readXlsx(buffer).map((sheet) => {
    const rows = Array.from(sheet.rows, (r) => Array.from(r ?? [], (v) => (v === undefined ? null : v)));
    const headerIndex = rows.findIndex((r) => r.some((v) => v !== null && v !== ''));
    if (headerIndex < 0) return { sheet: sheet.name, records: [] };
    const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
    const seen = new Map();
    const headers = Array.from({ length: width }, (_, i) => {
      const raw = rows[headerIndex][i];
      const name = raw === null || raw === undefined || raw === '' ? `Column ${i + 1}` : String(raw).trim();
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      return n > 1 ? `${name} (${n})` : name;
    });
    const records = rows
      .slice(headerIndex + 1)
      .filter((r) => r.some((v) => v !== null && v !== ''))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? null])));
    return { sheet: sheet.name, records };
  });
}

module.exports = { readXlsx, workbookTables, serialToIso };

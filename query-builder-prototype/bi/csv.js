'use strict';

/**
 * RFC 4180 CSV parser: quoted fields, doubled quotes, commas and newlines
 * inside quotes, CRLF or LF line endings, UTF-8 BOM. The Wells export needs all
 * of these (e.g. "No Artificial Lift ... : Water Injection."), which the old
 * prototype's comma split could not handle.
 */
function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += ch;
  }
  if (inQuotes) throw new Error('CSV ends inside a quoted field — check for an unbalanced quote.');
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }

  const nonBlank = records.filter((r) => !(r.length === 1 && r[0] === ''));
  if (!nonBlank.length) return { headers: [], rows: [] };
  const [headers, ...rows] = nonBlank;
  return { headers, rows };
}

/** Parses CSV into objects keyed by header; missing trailing cells become ''. */
function csvToRecords(text) {
  const { headers, rows } = parseCsv(text);
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

module.exports = { parseCsv, csvToRecords };

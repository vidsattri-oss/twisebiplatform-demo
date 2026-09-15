'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToRecords } = require('../csv');

test('parses quoted commas, doubled quotes and embedded newlines', () => {
  const { headers, rows } = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n');
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.deepEqual(rows, [['x, y', 'say "hi"', 'line1\nline2']]);
});

test('handles CRLF, BOM and a missing trailing newline', () => {
  const { headers, rows } = parseCsv('﻿"Parameter","Plant Code"\r\n"Plan - Due Wells","3524"');
  assert.deepEqual(headers, ['Parameter', 'Plant Code']);
  assert.deepEqual(rows, [['Plan - Due Wells', '3524']]);
});

test('keeps empty fields and skips blank lines', () => {
  const { rows } = parseCsv('a,b,c\n1,,3\n\n4,5,\n');
  assert.deepEqual(rows, [['1', '', '3'], ['4', '5', '']]);
});

test('csvToRecords fills missing trailing cells with empty strings', () => {
  assert.deepEqual(csvToRecords('a,b\n1\n'), [{ a: '1', b: '' }]);
});

test('rejects an unbalanced quote instead of silently merging rows', () => {
  assert.throws(() => parseCsv('a,b\n"open,1\n'), /unbalanced quote/);
});

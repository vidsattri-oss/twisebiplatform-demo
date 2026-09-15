'use strict';
/** S2: the dependency-free .xlsx reader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { workbookTables, serialToIso } = require('../xlsx');
const { crewWorkbook, zip } = require('./helpers/xlsx-fixture');

test('reads shared, inline and formula strings, numbers, booleans and date-formatted serials, one table per sheet', () => {
  assert.deepEqual(workbookTables(crewWorkbook()), [
    {
      sheet: 'Tasks',
      records: [
        { Crew: 'Crew A & B', Hours: 9.5, Date: '2026-09-14', Done: true },
        { Crew: 'Crew C', Hours: null, Date: '2026-09-14 12:00:00', Done: false },
      ],
    },
    { sheet: 'Empty', records: [] },
  ]);
});

test('Excel serials convert in the 1900 date system', () => {
  assert.equal(serialToIso(46279), '2026-09-14');
  assert.equal(serialToIso(45658.25), '2025-01-01 06:00:00');
});

test('files that are not workbooks, or have no workbook part, are refused with a readable message', () => {
  assert.throws(() => workbookTables(Buffer.from('crew,hours\nCrew A,9')), /isn't an Excel workbook/);
  assert.throws(() => workbookTables(zip({ 'readme.txt': 'hello' })), /has no xl\/workbook\.xml/);
});

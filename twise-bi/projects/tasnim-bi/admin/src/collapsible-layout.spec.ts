import { DEFAULT_DATA_SOURCES_LAYOUT, parseDataSourcesLayout } from './collapsible-layout';

describe('parseDataSourcesLayout (D1)', () => {
  it('starts with tables open and the reference sections closed', () => {
    expect(parseDataSourcesLayout(null)).toEqual(DEFAULT_DATA_SOURCES_LAYOUT);
    expect(DEFAULT_DATA_SOURCES_LAYOUT.open).toEqual({ tables: true, datasetFilters: false, relationships: false, measures: false });
  });

  it('keeps stored choices and ignores anything unknown or malformed', () => {
    expect(parseDataSourcesLayout(JSON.stringify({ connectionsCollapsed: true, open: { tables: false, measures: true, extra: true } }))).toEqual({
      connectionsCollapsed: true,
      open: { tables: false, datasetFilters: false, relationships: false, measures: true },
    });
    expect(parseDataSourcesLayout(JSON.stringify({ connectionsCollapsed: 'yes', open: { tables: 'no' } }))).toEqual(DEFAULT_DATA_SOURCES_LAYOUT);
    expect(parseDataSourcesLayout('{not json')).toEqual(DEFAULT_DATA_SOURCES_LAYOUT);
  });
});

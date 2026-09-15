import { ReportCategory, ReportSummary } from '@tasnim/bi/core';
import { UNCATEGORISED, glyphShapes, groupSections, parseHomeState, relativeTime, tabCounts, visibleReports } from './report-home';

const reports: ReportSummary[] = [
  { id: 1, name: 'Wells Readiness', modelId: 3, category: 'Operational Dashboard', description: 'Plan v/s actual funnel', status: 'published', updatedAt: '2026-09-13T10:00:00Z' },
  { id: 2, name: 'Operations Overview', modelId: 1, category: 'Productivity', description: 'Crew productivity', status: 'published', updatedAt: '2026-09-15T08:00:00Z' },
  { id: 3, name: 'ad hoc crew check', modelId: 1, category: null, status: 'draft', updatedAt: '2026-09-14T09:00:00Z' },
  { id: 4, name: 'Sales Pipeline', modelId: 2, category: 'Commercial', status: 'published', updatedAt: '2026-09-01T09:00:00Z' },
];
const categories: ReportCategory[] = [
  { name: 'Operational Dashboard', color: '#2841A3', description: 'Readiness' },
  { name: 'Productivity', color: '#E38200' },
  { name: 'Commercial', color: '#6A4BC4' },
  { name: 'Empty', color: '#000000' },
];
const recent = [{ reportId: 4, openedAt: '2026-09-15T12:00:00Z' }, { reportId: 1, openedAt: '2026-09-15T11:00:00Z' }];

describe('Reports home rules (R1)', () => {
  it('counts tabs, ignoring favorites and recent entries for deleted reports', () => {
    expect(tabCounts(reports, [2, 99], [...recent, { reportId: 42, openedAt: '2026-09-15T10:00:00Z' }])).toEqual({ all: 4, favorites: 1, recent: 2 });
  });

  it('filters by tab, search (name, description, category) and category, then sorts', () => {
    const q = { tab: 'all' as const, search: '', category: null, sort: 'name-asc' as const };
    expect(visibleReports(reports, [], recent, q).map((r) => r.id)).toEqual([3, 2, 4, 1]);
    expect(visibleReports(reports, [], recent, { ...q, sort: 'name-desc' }).map((r) => r.id)).toEqual([1, 4, 2, 3]);
    expect(visibleReports(reports, [], recent, { ...q, sort: 'updated' }).map((r) => r.id)).toEqual([2, 3, 1, 4]);
    expect(visibleReports(reports, [], recent, { ...q, sort: 'opened' }).map((r) => r.id)).toEqual([4, 1, 3, 2]);
    expect(visibleReports(reports, [2, 3], recent, { ...q, tab: 'favorites' }).map((r) => r.id)).toEqual([3, 2]);
    expect(visibleReports(reports, [], recent, { ...q, tab: 'recent' }).map((r) => r.id)).toEqual([4, 1]);
    expect(visibleReports(reports, [], recent, { ...q, search: 'CREW' }).map((r) => r.id)).toEqual([3, 2]);
    expect(visibleReports(reports, [], recent, { ...q, search: 'commercial' }).map((r) => r.id)).toEqual([4]);
    expect(visibleReports(reports, [], recent, { ...q, category: UNCATEGORISED }).map((r) => r.id)).toEqual([3]);
  });

  it('groups into sections in category order, skipping empty categories and putting uncategorised last', () => {
    const sections = groupSections(reports, categories);
    expect(sections.map((s) => [s.name, s.reports.map((r) => r.id)])).toEqual([
      ['Operational Dashboard', [1]],
      ['Productivity', [2]],
      ['Commercial', [4]],
      [UNCATEGORISED, [3]],
    ]);
    expect(sections[0].color).toBe('#2841A3');
  });

  it('describes update times the way TWise does', () => {
    const now = Date.parse('2026-09-15T12:00:00Z');
    expect(relativeTime('2026-09-15T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-09-15T11:15:00Z', now)).toBe('45m ago');
    expect(relativeTime('2026-09-15T02:00:00Z', now)).toBe('10h ago');
    expect(relativeTime('2026-09-13T12:00:00Z', now)).toBe('2d ago');
    expect(relativeTime('2026-06-01T12:00:00Z', now)).toBe('1 Jun 2026');
  });

  it('picks preview shapes from the visuals a report uses', () => {
    expect(glyphShapes(['slicer', 'column', 'bar', 'table', 'card'])).toEqual(['bars', 'table', 'card']);
    expect(glyphShapes(['bullet-chart'])).toEqual(['custom']);
    expect(glyphShapes([])).toEqual(['bars', 'pie', 'table']);
  });

  it('restores the saved tab, sort, view and collapsed sections, falling back on bad data', () => {
    expect(parseHomeState(JSON.stringify({ tab: 'recent', sort: 'opened', view: 'compact', collapsed: ['Commercial', 3] }))).toEqual({ tab: 'recent', sort: 'opened', view: 'compact', collapsed: ['Commercial'] });
    expect(parseHomeState('{oops')).toEqual({ tab: 'all', sort: 'name-asc', view: 'grid', collapsed: [] });
  });
});

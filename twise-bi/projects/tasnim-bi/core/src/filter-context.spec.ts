import { BiFilter, PageDefinition, ReportDefinition, VisualDefinition, VisualInteraction } from './contract';
import {
  ContextInput,
  Selection,
  buildVisualContext,
  dateLevelRange,
  pointFilters,
  seeRecordsFilters,
  toggleSelection,
} from './filter-context';

const T = 'WellsReadinessPlanVsActual';
const basic = (column: string, values: (string | null)[]): BiFilter => ({ kind: 'basic', target: { table: T, column }, operator: 'in', values });

const chart: VisualDefinition = {
  id: 'readiness',
  type: 'column',
  roles: { category: [{ table: T, column: 'Parameter' }], values: [{ measure: 'Well Count' }] },
  filters: [basic('Well Type', ['ESP'])],
};
const other: VisualDefinition = { id: 'by-plant', type: 'bar', roles: { category: [{ table: T, column: 'Plant Description' }], values: [{ measure: 'Well Count' }] }, filters: [] };
const table: VisualDefinition = { id: 'details', type: 'table', roles: { columns: [{ table: T, column: 'Parameter' }] }, filters: [] };
const plantSlicer: VisualDefinition = { id: 'plant', type: 'slicer', roles: { field: [{ table: T, column: 'Plant Description' }] }, filters: [] };

const page: PageDefinition = { id: 'p', name: 'Page', filters: [basic('Parameter', ['Plan - Due Wells'])], visuals: [chart, other, table, plantSlicer] };
const report: ReportDefinition = { filters: [basic('Plant Code', ['3524'])], pages: [page] };
const defaults: Record<string, VisualInteraction> = { column: 'highlight', bar: 'highlight', table: 'filter', slicer: 'filter' };

const selection: Selection = { visualId: 'readiness', field: { table: T, column: 'Parameter' }, values: ['Actual - Wells Completed'] };

function input(visual: VisualDefinition, overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    report,
    page,
    visual,
    hostFilters: [basic('Plant Description', ['Marmul ODC'])],
    slicerFilters: { plant: basic('Plant Description', ['Nimr ODC']) },
    selection: null,
    interactionFor: (source, target) => source.interactions?.[target.id] ?? defaults[target.type] ?? 'filter',
    ...overrides,
  };
}

describe('buildVisualContext', () => {
  it('unions host, report, page, visual and slicer filters, recording where each came from', () => {
    const ctx = buildVisualContext(input(chart));
    expect(ctx.origins.map((o) => o.scope)).toEqual(['host', 'report', 'page', 'visual', 'slicer']);
    expect(ctx.filters).toHaveLength(5);
    expect(ctx.highlight).toBeUndefined();
  });

  it('never applies a slicer to itself', () => {
    const ctx = buildVisualContext(input(plantSlicer));
    expect(ctx.origins.some((o) => o.scope === 'slicer')).toBe(false);
  });

  it('highlights the source visual instead of filtering it (I4)', () => {
    const ctx = buildVisualContext(input(chart, { selection }));
    expect(ctx.highlight).toEqual([basic('Parameter', ['Actual - Wells Completed'])]);
    expect(ctx.origins.some((o) => o.scope === 'selection')).toBe(false);
  });

  it('highlights other charts and filters tables by default', () => {
    expect(buildVisualContext(input(other, { selection })).highlight).toHaveLength(1);
    const tableCtx = buildVisualContext(input(table, { selection }));
    expect(tableCtx.highlight).toBeUndefined();
    expect(tableCtx.origins.at(-1)).toEqual({ scope: 'selection', visualId: 'readiness' });
  });

  it('honours per-visual interaction settings, including none', () => {
    const configured = { ...chart, interactions: { 'by-plant': 'filter' as const, details: 'none' as const } };
    const pageWith = { ...page, visuals: [configured, other, table, plantSlicer] };
    const filtered = buildVisualContext(input(other, { page: pageWith, selection }));
    expect(filtered.highlight).toBeUndefined();
    expect(filtered.origins.at(-1)?.scope).toBe('selection');
    const untouched = buildVisualContext(input(table, { page: pageWith, selection }));
    expect(untouched.origins.some((o) => o.scope === 'selection')).toBe(false);
    expect(untouched.highlight).toBeUndefined();
  });

  it('ignores a selection whose source visual is not on this page', () => {
    const ctx = buildVisualContext(input(other, { selection: { ...selection, visualId: 'elsewhere' } }));
    expect(ctx.highlight).toBeUndefined();
  });
});

describe('seeRecordsFilters (I3)', () => {
  it('is the visual context plus the data point, and excludes any highlight', () => {
    const ctx = buildVisualContext(input(other, { selection }));
    const filters = seeRecordsFilters(ctx, [{ table: T, column: 'Plant Description' }], ['Marmul ODC']);
    expect(filters.slice(0, ctx.filters.length)).toEqual(ctx.filters);
    expect(filters.at(-1)).toEqual(basic('Plant Description', ['Marmul ODC']));
    expect(filters).not.toContainEqual(basic('Parameter', ['Actual - Wells Completed']));
  });
});

describe('pointFilters and dateLevelRange', () => {
  it('turns date-level keys into inclusive ranges', () => {
    expect(dateLevelRange('year', '2026')).toEqual(['2026-01-01', '2026-12-31']);
    expect(dateLevelRange('quarter', '2026-Q1')).toEqual(['2026-01-01', '2026-03-31']);
    expect(dateLevelRange('month', '2024-02')).toEqual(['2024-02-01', '2024-02-29']);
    expect(pointFilters([{ table: T, column: 'Planned Completion Date (Date)', dateLevel: 'month' }], ['2026-02'])).toEqual([
      { kind: 'range', target: { table: T, column: 'Planned Completion Date (Date)' }, min: '2026-02-01', max: '2026-02-28' },
    ]);
  });

  it('pins a blank category with a null value', () => {
    expect(pointFilters([{ table: T, column: 'Well Type' }], [null])).toEqual([basic('Well Type', [null])]);
  });
});

describe('toggleSelection', () => {
  const field = { table: T, column: 'Parameter' };
  it('selects, replaces, adds with Ctrl, and clears', () => {
    const a = toggleSelection(null, 'readiness', field, 'A', false);
    expect(a?.values).toEqual(['A']);
    expect(toggleSelection(a, 'readiness', field, 'B', false)?.values).toEqual(['B']);
    const ab = toggleSelection(a, 'readiness', field, 'B', true);
    expect(ab?.values).toEqual(['A', 'B']);
    expect(toggleSelection(ab, 'readiness', field, 'A', true)?.values).toEqual(['B']);
    expect(toggleSelection(a, 'readiness', field, 'A', false)).toBeNull();
  });

  it('starts a new selection when another visual is clicked', () => {
    const a = toggleSelection(null, 'readiness', field, 'A', false);
    expect(toggleSelection(a, 'by-plant', { table: T, column: 'Plant Description' }, 'Nimr ODC', true)).toEqual({
      visualId: 'by-plant',
      field: { table: T, column: 'Plant Description' },
      values: ['Nimr ODC'],
    });
  });

  it('keeps date-level selections to one period', () => {
    const month = { table: T, column: 'Planned Completion Date (Date)', dateLevel: 'month' as const };
    const jan = toggleSelection(null, 'trend', month, '2026-01', false);
    expect(toggleSelection(jan, 'trend', month, '2026-02', true)?.values).toEqual(['2026-02']);
  });
});

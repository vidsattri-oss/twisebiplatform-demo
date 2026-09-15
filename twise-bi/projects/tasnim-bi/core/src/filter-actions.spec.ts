import { BiFilter, ReportDefinition } from './contract';
import { includeExcludeFilters, presetLabel, restoreSavedFilters, slicerDefaults } from './filter-actions';

const T = 'WellsReadinessPlanVsActual';
const basic = (column: string, values: (string | null)[]): BiFilter => ({ kind: 'basic', target: { table: T, column }, operator: 'in', values });

describe('includeExcludeFilters', () => {
  it('includes a category value as an "is" filter and excludes it as "is not"', () => {
    const fields = [{ table: T, column: 'Parameter' }];
    const [inc] = includeExcludeFilters(fields, ['Plan - Due Wells'], 'include');
    expect(inc).toMatchObject({ kind: 'basic', operator: 'in', values: ['Plan - Due Wells'] });
    expect(includeExcludeFilters(fields, [null], 'exclude')).toEqual([{ kind: 'basic', target: fields[0], operator: 'notIn', values: [null] }]);
  });

  it('excludes a date-level period as "before or after" its range', () => {
    const [f] = includeExcludeFilters([{ table: T, column: 'Planned Completion Date (Date)', dateLevel: 'quarter' }], ['2026-Q1'], 'exclude');
    expect(f).toEqual({
      kind: 'advanced',
      target: { table: T, column: 'Planned Completion Date (Date)' },
      logic: 'or',
      conditions: [{ operator: 'lt', value: '2026-01-01' }, { operator: 'gt', value: '2026-03-31' }],
    });
  });
});

describe('slicer defaults and reset', () => {
  const saved: ReportDefinition = {
    filters: [basic('Plant Code', ['3524'])],
    pages: [{
      id: 'p1', name: 'Readiness', filters: [],
      visuals: [
        { id: 'plant', type: 'slicer', roles: {}, filters: [], options: { defaultFilter: basic('Plant Description', ['Marmul ODC']) } },
        { id: 'chart', type: 'column', title: 'Readiness', roles: {}, filters: [basic('Well Type', ['ESP'])] },
      ],
    }],
  };

  it('collects each slicer default by visual id', () => {
    expect(slicerDefaults(saved)).toEqual({ plant: basic('Plant Description', ['Marmul ODC']) });
  });

  it('puts filters back to their saved values but keeps other edits', () => {
    const current: ReportDefinition = {
      filters: [],
      pages: [{
        ...saved.pages[0],
        filters: [basic('Parameter', ['x'])],
        visuals: [
          saved.pages[0].visuals[0],
          { ...saved.pages[0].visuals[1], title: 'Renamed', filters: [] },
          { id: 'new', type: 'card', roles: {}, filters: [basic('Well Type', ['BP'])] },
        ],
      }],
    };
    const restored = restoreSavedFilters(current, saved);
    expect(restored.filters).toEqual(saved.filters);
    expect(restored.pages[0].filters).toEqual([]);
    expect(restored.pages[0].visuals[1]).toMatchObject({ title: 'Renamed', filters: [basic('Well Type', ['ESP'])] });
    expect(restored.pages[0].visuals[2].filters).toEqual([basic('Well Type', ['BP'])]);
  });
});

describe('presetLabel', () => {
  it('recognises Today, Yesterday and Last N days', () => {
    expect(presetLabel({ period: 'this', count: 1, unit: 'day' })).toBe('Today');
    expect(presetLabel({ period: 'last', count: 1, unit: 'day', includeToday: false })).toBe('Yesterday');
    expect(presetLabel({ period: 'last', count: 30, unit: 'day' })).toBe('Last 30 days');
    expect(presetLabel({ period: 'last', count: 2, unit: 'week' })).toBeNull();
  });
});

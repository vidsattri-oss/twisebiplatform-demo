import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BiFilter, Report, SemanticModel } from './contract';
import { BI_DATA_SOURCE, BiDataSource } from './data-source';
import { ReportStore } from './report-store';
import { BI_VISUALS, BiVisualType } from './visual-registry';

const T = 'tasks';
const basic = (column: string, values: (string | null)[]): BiFilter => ({ kind: 'basic', target: { table: T, column }, operator: 'in', values });
const load = () => Promise.resolve(class {});
const types: BiVisualType[] = [
  { type: 'column', label: 'Column', icon: '', dataKind: 'aggregate', roles: [], defaultInteraction: 'highlight', loadComponent: load },
  { type: 'table', label: 'Table', icon: '', dataKind: 'rows', roles: [], defaultInteraction: 'filter', loadComponent: load },
  { type: 'slicer', label: 'Slicer', icon: '', dataKind: 'slicer', roles: [], defaultInteraction: 'filter', loadComponent: load },
];

const model: SemanticModel = { id: 1, name: 'Ops', tables: [], relationships: [], measures: [], datasetFilters: [basic('status', ['Active'])] };
const report: Report = {
  id: 7,
  name: 'Operations',
  modelId: 1,
  definition: {
    filters: [basic('region', ['North'])],
    pages: [{
      id: 'p1', name: 'Overview', filters: [],
      visuals: [
        { id: 'crew', type: 'column', roles: { category: [{ table: T, column: 'crew' }], values: [{ measure: 'Tasks' }] }, filters: [] },
        { id: 'rows', type: 'table', roles: { columns: [{ table: T, column: 'status' }, { table: T, column: 'crew' }] }, filters: [] },
        { id: 'shift', type: 'slicer', roles: { field: [{ table: T, column: 'shift' }] }, filters: [], options: { defaultFilter: basic('shift', ['Day']) } },
      ],
    }],
  },
};

function setup(): ReportStore {
  const ds = { getReport: () => of(report), getModel: () => of(model) } as Partial<BiDataSource> as BiDataSource;
  TestBed.configureTestingModule({
    providers: [ReportStore, { provide: BI_DATA_SOURCE, useValue: ds }, ...types.map((t) => ({ provide: BI_VISUALS, useValue: t, multi: true }))],
  });
  const store = TestBed.inject(ReportStore);
  store.load(7);
  return store;
}

const visual = (store: ReportStore, id: string) => store.page()!.visuals.find((v) => v.id === id)!;

describe('ReportStore filter and cross-filter state', () => {
  it('opens slicers on their saved default selection and exposes dataset filters', () => {
    const store = setup();
    expect(store.slicerFilters()).toEqual({ shift: basic('shift', ['Day']) });
    expect(store.datasetFilters()).toEqual([basic('status', ['Active'])]);
    expect(store.canReset()).toBe(false);
  });

  it('adds to the selection on a plain click when multi-select without Ctrl is on', () => {
    const store = setup();
    store.select(visual(store, 'crew'), ['Crew A'], false);
    store.select(visual(store, 'crew'), ['Crew B'], false);
    expect(store.selection()?.values).toEqual(['Crew B']);

    store.setMultiSelectWithoutCtrl(true);
    store.select(visual(store, 'crew'), ['Crew C'], false);
    expect(store.selection()?.values).toEqual(['Crew B', 'Crew C']);
  });

  it('selects table rows by their first column (C1)', () => {
    const store = setup();
    store.select(visual(store, 'rows'), ['Completed'], false);
    expect(store.selection()).toEqual({ visualId: 'rows', field: { table: T, column: 'status' }, values: ['Completed'] });
  });

  it('Include and Exclude add visual-level filters and clear that visual’s selection', () => {
    const store = setup();
    store.select(visual(store, 'crew'), ['Crew A'], false);
    store.includeExclude(visual(store, 'crew'), ['Crew A'], 'exclude');
    expect(visual(store, 'crew').filters).toEqual([{ kind: 'basic', target: { table: T, column: 'crew' }, operator: 'notIn', values: ['Crew A'], scope: 'visual' }]);
    expect(store.selection()).toBeNull();
  });

  it('Reset to default restores saved filters and slicer defaults and clears the selection in one step (L8)', () => {
    const store = setup();
    store.includeExclude(visual(store, 'crew'), ['Crew A'], 'include');
    store.replaceFilter('report', 0, basic('region', ['South']));
    store.setSlicerFilter('shift', basic('shift', ['Night']));
    store.select(visual(store, 'crew'), ['Crew B'], false);
    expect(store.canReset()).toBe(true);

    store.resetToDefault();
    expect(store.report()!.definition.filters).toEqual([basic('region', ['North'])]);
    expect(visual(store, 'crew').filters).toEqual([]);
    expect(store.slicerFilters()).toEqual({ shift: basic('shift', ['Day']) });
    expect(store.selection()).toBeNull();
    expect(store.canReset()).toBe(false);
  });

  it('saves the current slicer selection as its default, or clears the default', () => {
    const store = setup();
    store.setSlicerFilter('shift', basic('shift', ['Night']));
    store.setSlicerDefault('shift');
    expect(visual(store, 'shift').options?.['defaultFilter']).toEqual(basic('shift', ['Night']));

    store.setSlicerFilter('shift', null);
    store.setSlicerDefault('shift');
    expect(visual(store, 'shift').options?.['defaultFilter']).toBeUndefined();
  });
});

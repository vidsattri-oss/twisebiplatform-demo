import { TestBed } from '@angular/core/testing';
import { SemanticModel } from '@tasnim/bi';
import { GlobalFiltersService } from './global-filters.service';
import { TwiseFilterBridge } from './twise-filter-bridge';

const wells: SemanticModel = {
  id: 3, name: 'Wells', relationships: [], measures: [],
  tables: [{ name: 'WellsReadinessPlanVsActual', rowCount: 1122, columns: [
    { name: 'Plant Description', dataType: 'text' },
    { name: 'Planned Completion Date (Date)', dataType: 'date' },
  ] }],
};
const operations: SemanticModel = {
  id: 1, name: 'Operations', relationships: [], measures: [],
  tables: [{ name: 'tasks', rowCount: 200, columns: [{ name: 'task_date', dataType: 'date' }, { name: 'status', dataType: 'text' }] }],
};

describe('TwiseFilterBridge', () => {
  let globals: GlobalFiltersService;
  let bridge: TwiseFilterBridge;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TwiseFilterBridge] });
    globals = TestBed.inject(GlobalFiltersService);
    bridge = TestBed.inject(TwiseFilterBridge);
  });

  it('sends nothing while the filter bar is empty', () => {
    expect(bridge.filtersFor(wells)).toEqual([]);
  });

  it('maps Plant and the date range onto columns the model actually has', () => {
    globals.plant.set('Marmul ODC');
    globals.from.set('2026-01-01');
    expect(bridge.filtersFor(wells)).toEqual([
      { kind: 'basic', target: { table: 'WellsReadinessPlanVsActual', column: 'Plant Description' }, operator: 'in', values: ['Marmul ODC'], scope: 'report' },
      { kind: 'range', target: { table: 'WellsReadinessPlanVsActual', column: 'Planned Completion Date (Date)' }, min: '2026-01-01', max: null, scope: 'report' },
    ]);
  });

  it('skips filters a model has no column for', () => {
    globals.plant.set('Marmul ODC');
    globals.to.set('2026-06-30');
    expect(bridge.filtersFor(operations)).toEqual([
      { kind: 'range', target: { table: 'tasks', column: 'task_date' }, min: null, max: '2026-06-30', scope: 'report' },
    ]);
  });
});

import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { QueryResult, Report, SemanticModel, VisualDefinition, VisualQuery } from '../core/contract';
import { BI_DATA_SOURCE, BiDataSource } from '../core/data-source';
import { BI_VISUALS, BiVisualType } from '../core/visual-registry';
import { BI_VISUAL_CONTEXT } from '../visuals/visual-context';
import { ReportStore } from './report-store';
import { VisualHostComponent } from './visual-host.component';

@Component({ selector: 'bi-test-visual', template: `{{ ctx.result()?.rows?.length ?? 'none' }}` })
class TestVisualComponent {
  readonly ctx = inject(BI_VISUAL_CONTEXT);
}

const T = 'WellsReadinessPlanVsActual';
const visual: VisualDefinition = {
  id: 'readiness',
  type: 'test-column',
  roles: { category: [{ table: T, column: 'Parameter' }], values: [{ measure: 'Well Count' }] },
  filters: [],
};
const model: SemanticModel = { id: 3, name: 'Wells', tables: [{ name: T, rowCount: 3, columns: [{ name: 'Parameter', dataType: 'text' }] }], relationships: [], measures: [{ name: 'Well Count', table: T, expression: 'COUNTROWS(WellsReadinessPlanVsActual)', origin: 'model' }] };
const report: Report = { id: 1, name: 'Wells', modelId: 3, definition: { filters: [], pages: [{ id: 'p', name: 'Page', filters: [], visuals: [visual] }] } };
const testType: BiVisualType = {
  type: 'test-column', label: 'Test', icon: '', dataKind: 'aggregate', defaultInteraction: 'highlight',
  roles: [{ name: 'category', label: 'X-axis', kind: 'grouping', min: 1, max: 1 }, { name: 'values', label: 'Y-axis', kind: 'measure', min: 1, max: 1 }],
  loadComponent: () => Promise.resolve(TestVisualComponent),
};
const resultWith = (n: number): QueryResult => ({ columns: [], truncated: false, ignoredFilters: [], rows: Array.from({ length: n }, (_, i) => ({ keys: [`k${i}`], values: [i], highlights: null })) });

describe('VisualHostComponent data loading (I7)', () => {
  let calls: { query: VisualQuery; response: Subject<QueryResult>; cancelled: boolean }[];

  beforeEach(() => {
    calls = [];
    const dataSource = {
      query: (query: VisualQuery) =>
        new Observable<QueryResult>((subscriber) => {
          const call = { query, response: new Subject<QueryResult>(), cancelled: false };
          calls.push(call);
          const inner = call.response.subscribe(subscriber);
          return () => {
            call.cancelled = true;
            inner.unsubscribe();
          };
        }),
    } as Partial<BiDataSource> as BiDataSource;

    TestBed.configureTestingModule({
      providers: [ReportStore, { provide: BI_DATA_SOURCE, useValue: dataSource }, { provide: BI_VISUALS, useValue: testType, multi: true }],
    });
  });

  function setup() {
    const store = TestBed.inject(ReportStore);
    store.model.set(model);
    store.report.set(report);
    const fixture = TestBed.createComponent(VisualHostComponent);
    fixture.componentRef.setInput('visual', visual);
    TestBed.tick();
    return { store, fixture };
  }

  it('cancels a superseded query and renders only the latest response', async () => {
    const { store, fixture } = setup();
    expect(calls).toHaveLength(1);
    expect(calls[0].query.highlight).toBeUndefined();

    store.select(visual, ['Actual - Wells Completed'], false);
    TestBed.tick();
    expect(calls).toHaveLength(2);
    expect(calls[0].cancelled).toBe(true);
    expect(calls[1].query.highlight).toEqual([{ kind: 'basic', target: { table: T, column: 'Parameter' }, operator: 'in', values: ['Actual - Wells Completed'] }]);

    calls[0].response.next(resultWith(1)); // late response from the cancelled request
    calls[1].response.next(resultWith(10));
    TestBed.tick();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['visualContext'].result()?.rows).toHaveLength(10);
  });

  it('does not re-query when an unrelated signal changes', () => {
    const { store } = setup();
    store.editMode.set(true);
    store.focusedVisualId.set('readiness');
    TestBed.tick();
    expect(calls).toHaveLength(1);
  });
});

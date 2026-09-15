import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BI_DATA_SOURCE, BiDataSource, SemanticModel } from '@tasnim/bi/core';
import { MeasureEditorComponent } from './measure-editor.component';

// Regression (QA 2026-09-15): one failed validate request ended the stream and toSignal rethrew on every read.
describe('MeasureEditorComponent validation', () => {
  const model: SemanticModel = {
    id: 1, name: 'Operations', relationships: [],
    tables: [{ name: 'tasks', rowCount: 200, columns: [{ name: 'actual_hours', dataType: 'number' }] }],
    measures: [{ name: 'Task Count', table: 'tasks', expression: 'COUNTROWS(tasks)', origin: 'model' }],
  };
  let failNext = true;

  beforeEach(() => {
    failNext = true;
    const dataSource = {
      listModels: () => of([{ id: 1, name: 'Operations', fileName: 'data.db', status: 'connected' as const, tableCount: 1 }]),
      getModel: () => of(model),
      validateMeasure: () => (failNext ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ ok: true, dependencies: [] })),
    } as Partial<BiDataSource> as BiDataSource;
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BI_DATA_SOURCE, useValue: dataSource }] });
  });

  it('reports a failed request as a readable result and keeps validating afterwards', async () => {
    const fixture = TestBed.createComponent(MeasureEditorComponent);
    const editor = fixture.componentInstance as unknown as { expression: { set(v: string): void }; validation: () => { ok: boolean; error?: { error: string } } | null };
    await fixture.whenStable();

    editor.expression.set('SUM(tasks[actual_hours])');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(() => editor.validation()).not.toThrow();
    expect(editor.validation()?.ok).toBe(false);
    expect(editor.validation()?.error?.error).toMatch(/Can't reach the BI service/);

    failNext = false;
    editor.expression.set('SUM(tasks[actual_hours]) * 2');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(editor.validation()?.ok).toBe(true);
  });
});

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BI_DATA_SOURCE, BiDataSource, SemanticModel } from '@tasnim/bi/core';
import { FormulaEditorComponent, busiestTable } from './formula-editor.component';

const model: SemanticModel = {
  id: 1, name: 'Operations', relationships: [],
  tables: [
    { name: 'crews', rowCount: 4, columns: [{ name: 'name', dataType: 'text' }] },
    { name: 'tasks', rowCount: 200, columns: [{ name: 'actual_hours', dataType: 'number' }] },
  ],
  measures: [{ name: 'Task Count', table: 'tasks', expression: 'COUNTROWS(tasks)', origin: 'model' }],
};

// Regression (QA 2026-09-15), moved with the editor from the Formulas page: one failed validate request
// ended the stream and toSignal rethrew on every read.
describe('FormulaEditorComponent validation', () => {
  let failNext = true;

  beforeEach(() => {
    failNext = true;
    const dataSource = {
      validateMeasure: () => (failNext ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ ok: true, dependencies: [] })),
    } as Partial<BiDataSource> as BiDataSource;
    TestBed.configureTestingModule({ providers: [{ provide: BI_DATA_SOURCE, useValue: dataSource }] });
  });

  it('reports a failed request as a readable result and keeps validating afterwards', async () => {
    const fixture = TestBed.createComponent(FormulaEditorComponent);
    fixture.componentRef.setInput('model', model);
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

  it('defaults to the table most measures live on', () => {
    expect(busiestTable(model)).toBe('tasks');
    expect(busiestTable({ ...model, measures: [] })).toBe('crews');
  });
});

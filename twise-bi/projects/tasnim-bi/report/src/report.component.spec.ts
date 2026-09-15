import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { BI_DATA_SOURCE, BiDataSource } from '@tasnim/bi/core';
import { ReportComponent } from './report.component';

/**
 * Regression: routed through BI_ROUTES with withComponentInputBinding(), Angular
 * sets every input that isn't a route param to undefined. canEdit then became
 * undefined and the Edit button never rendered, although hosts never passed false.
 */
describe('ReportComponent canEdit', () => {
  beforeEach(() => {
    const dataSource = { getReport: () => NEVER, getModel: () => NEVER } as Partial<BiDataSource> as BiDataSource;
    TestBed.configureTestingModule({ providers: [{ provide: BI_DATA_SOURCE, useValue: dataSource }] });
  });

  function canEditAfterBinding(value: boolean | undefined): boolean {
    const fixture = TestBed.createComponent(ReportComponent);
    fixture.componentRef.setInput('canEdit', value);
    return fixture.componentInstance.canEdit();
  }

  it('stays editable when router input binding sets canEdit to undefined', () => {
    expect(canEditAfterBinding(undefined)).toBe(true);
  });

  it('is read-only only when the host passes false', () => {
    expect(canEditAfterBinding(false)).toBe(false);
    expect(canEditAfterBinding(true)).toBe(true);
  });
});

import { SemanticModel } from './contract';
import { describeFilter } from './describe-filter';

const T = 'WellsReadinessPlanVsActual';
const model: SemanticModel = {
  id: 3,
  name: 'Wells',
  relationships: [],
  measures: [],
  tables: [{ name: T, rowCount: 1122, columns: [
    { name: 'Plant Description', dataType: 'text' },
    { name: 'Planned Completion Date (Date)', dataType: 'date' },
    { name: 'FLAF Delay', dataType: 'number', format: '#,0' },
  ] }],
};
const target = (column: string) => ({ table: T, column });

describe('describeFilter', () => {
  it('summarises basic filters, including blanks and long lists', () => {
    expect(describeFilter({ kind: 'basic', target: target('Plant Description'), operator: 'in', values: ['Marmul ODC'] }, model)).toBe('Plant Description is Marmul ODC');
    expect(describeFilter({ kind: 'basic', target: target('Plant Description'), operator: 'notIn', values: [null] }, model)).toBe('Plant Description is not (Blank)');
    expect(describeFilter({ kind: 'basic', target: target('Plant Description'), operator: 'in', values: ['a', 'b', 'c', 'd'] }, model)).toBe('Plant Description is 4 values');
  });

  it('formats dates and numbers with the column format', () => {
    expect(describeFilter({ kind: 'range', target: target('Planned Completion Date (Date)'), min: '2026-01-01', max: '2026-06-30' }, model))
      .toBe('Planned Completion Date (Date) is between 01-01-2026 and 30-06-2026');
    expect(describeFilter({ kind: 'range', target: target('Planned Completion Date (Date)'), min: '2026-01-01' }, model))
      .toBe('Planned Completion Date (Date) is on or after 01-01-2026');
    expect(describeFilter({ kind: 'advanced', target: target('FLAF Delay'), logic: 'or', conditions: [{ operator: 'gt', value: 1200 }, { operator: 'isBlank' }] }, model))
      .toBe('FLAF Delay is greater than 1,200 or is blank');
  });

  it('summarises relative date and Top N filters', () => {
    expect(describeFilter({ kind: 'relativeDate', target: target('Planned Completion Date (Date)'), period: 'last', count: 3, unit: 'month' }, model))
      .toBe('Planned Completion Date (Date) is in the last 3 months');
    expect(describeFilter({ kind: 'topN', target: target('Plant Description'), n: 5, by: 'Well Count', direction: 'top' }, model)).toBe('Top 5 Plant Description by Well Count');
  });

  it('names relative date presets and relative time windows', () => {
    const d = target('Planned Completion Date (Date)');
    expect(describeFilter({ kind: 'relativeDate', target: d, period: 'this', count: 1, unit: 'day' }, model)).toBe('Planned Completion Date (Date) is today');
    expect(describeFilter({ kind: 'relativeDate', target: d, period: 'last', count: 1, unit: 'day', includeToday: false }, model)).toBe('Planned Completion Date (Date) is yesterday');
    expect(describeFilter({ kind: 'relativeDate', target: d, period: 'last', count: 30, unit: 'day' }, model)).toBe('Planned Completion Date (Date) is in the last 30 days');
    expect(describeFilter({ kind: 'relativeDate', target: d, period: 'last', count: 2, unit: 'quarter', includeToday: false }, model))
      .toBe('Planned Completion Date (Date) is in the last 2 quarters (not including today)');
    expect(describeFilter({ kind: 'relativeTime', target: d, period: 'last', count: 24, unit: 'hour' }, model)).toBe('Planned Completion Date (Date) is in the last 24 hours');
  });
});

import type Highcharts from 'highcharts/esm/highcharts';
import { QueryResult } from '@tasnim/bi/core';
import { buildChartOptions } from './chart-options';

// Regression (QA 2026-09-15): stack and axis labels used the first measure's format for every measure.
describe('buildChartOptions number formats with several measures', () => {
  const result: QueryResult = {
    columns: [],
    truncated: false,
    ignoredFilters: [],
    rows: [{ keys: ['Crew A'], values: [50, 0.798], highlights: null }],
  };
  const options = buildChartOptions({
    kind: 'column',
    result,
    measureNames: ['Task Count', 'Productivity %'],
    measureFormats: ['#,0', '0.0%'],
    options: {},
    onSelect: () => undefined,
  });
  const yAxis = options.yAxis as Highcharts.YAxisOptions;

  it('labels each stack total with its own measure format', () => {
    const stackLabel = yAxis.stackLabels?.formatter as unknown as (this: { total: number; stack: string }) => string;
    expect(stackLabel.call({ total: 50, stack: 'm0' })).toBe('50');
    expect(stackLabel.call({ total: 0.798, stack: 'm1' })).toBe('79.8%');
  });

  it('falls back to plain numbers on a shared axis when measure formats differ', () => {
    const axisLabel = yAxis.labels?.formatter as unknown as (this: { value: number }) => string;
    expect(axisLabel.call({ value: 0.5 })).toBe('0.50');
  });
});

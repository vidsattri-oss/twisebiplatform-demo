import type Highcharts from 'highcharts/esm/highcharts';
import { QueryResult } from '@tasnim/bi/core';
import { DEFAULT_PALETTE, buildChartOptions, dim } from './chart-options';

const result = (highlights: (number | null)[] | null): QueryResult => ({
  columns: [],
  truncated: false,
  ignoredFilters: [],
  rows: [
    { keys: ['Plan - As per Rig Sequence'], values: [196], highlights: highlights ? [highlights[0]] : null },
    { keys: [null], values: [7], highlights: highlights ? [highlights[1]] : null },
    { keys: ['Actual - Wells Completed'], values: [316], highlights: highlights ? [highlights[2]] : null },
  ],
});

type PointData = { y: number | null; color: string; custom: { keys: unknown[] } };
const data = (options: Highcharts.Options, index: number) => ((options.series?.[index] as { data: PointData[] }).data);

function build(kind: 'column' | 'line' | 'pie', res: QueryResult, extra: Record<string, unknown> = {}, onSelect = vi.fn()) {
  return buildChartOptions({ kind, result: res, measureNames: ['Well Count'], measureFormats: ['#,0'], categoryType: 'text', options: extra, onSelect });
}

describe('buildChartOptions', () => {
  it('keeps category order from the query and labels blanks', () => {
    const options = build('column', result(null));
    expect((options.xAxis as Highcharts.XAxisOptions).categories).toEqual(['Plan - As per Rig Sequence', '(Blank)', 'Actual - Wells Completed']);
  });

  it('without a selection, renders full values and an empty highlight series of the same length', () => {
    const options = build('column', result(null));
    expect(data(options, 0).map((p) => p.y)).toEqual([196, 7, 316]);
    expect(data(options, 1).map((p) => p.y)).toEqual([null, null, null]);
    expect(options.series).toHaveLength(2);
  });

  it('with a highlight, stacks the highlighted share solid under a dimmed remainder (Power BI highlight)', () => {
    const options = build('column', result([0, 0, 316]));
    expect(data(options, 0).map((p) => p.y)).toEqual([196, 7, 0]);
    expect(data(options, 1).map((p) => p.y)).toEqual([0, 0, 316]);
    expect(data(options, 0)[0].color).toBe(dim(DEFAULT_PALETTE[0]));
    expect(data(options, 1)[2].color).toBe(DEFAULT_PALETTE[0]);
  });

  it('colours each category from the palette when colorByPoint is on', () => {
    const options = build('column', result(null), { colorByPoint: true });
    expect(data(options, 0).map((p) => p.color)).toEqual(DEFAULT_PALETTE.slice(0, 3));
  });

  it('dims unhighlighted pie slices instead of removing them', () => {
    const options = build('pie', result([0, 0, 316]));
    const slices = data(options, 0);
    expect(slices).toHaveLength(3);
    expect(slices[0].color).toBe(dim(DEFAULT_PALETTE[0]));
    expect(slices[2].color).toBe(DEFAULT_PALETTE[2]);
  });

  it('does not stack line charts', () => {
    const options = build('line', result([0, 0, 316]));
    expect(data(options, 0).map((p) => p.y)).toEqual([196, 7, 316]);
    expect((options.plotOptions?.line as { stacking?: string } | undefined)?.stacking).toBeUndefined();
  });

  it('passes the point keys and Ctrl/Cmd as additive to onSelect', () => {
    const onSelect = vi.fn();
    const options = build('column', result(null), {}, onSelect);
    const click = options.plotOptions?.series?.point?.events?.click as unknown as (this: unknown, e: { ctrlKey: boolean; metaKey: boolean }) => void;
    click.call({ options: { custom: { keys: ['Actual - Wells Completed'] } } }, { ctrlKey: true, metaKey: false });
    expect(onSelect).toHaveBeenCalledWith(['Actual - Wells Completed'], true);
  });
});

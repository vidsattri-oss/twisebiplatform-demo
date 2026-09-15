import type Highcharts from 'highcharts/esm/highcharts';
import { DataType, QueryResult, Scalar } from '@tasnim/bi/core';
import { formatKey, formatValue } from '@tasnim/bi/core';

export type ChartKind = 'column' | 'bar' | 'line' | 'pie' | 'donut';

/** Matches the Wells Readiness Power BI report's category colours first, then extends. */
export const DEFAULT_PALETTE = ['#21409A', '#6CCB7A', '#E6A12E', '#C9302C', '#5DB5EE', '#7A5AF8', '#0E9384', '#DD2590'];

export interface ChartBuildInput {
  kind: ChartKind;
  result: QueryResult;
  measureNames: string[];
  measureFormats: (string | undefined)[];
  categoryType?: DataType;
  categoryFormat?: string;
  options: Record<string, unknown>;
  palette?: string[];
  onSelect: (keys: Scalar[], additive: boolean) => void;
}

interface PointCustom {
  keys: Scalar[];
  value: number | null;
  highlight: number | null;
}

export function dim(color: string, alpha = 0.3): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const AXIS_TEXT = '#475467';
const GRID = '#EAECF0';

/**
 * Pure Highcharts options for the built-in chart visuals.
 *
 * Highlight follows Power BI: every category stays, and each bar splits into
 * the highlighted share (solid, bottom) and the remainder (dimmed, top) via a
 * stacked pair of series per measure. Both series always exist, so option
 * updates never need to add or remove series.
 */
export function buildChartOptions(input: ChartBuildInput): Highcharts.Options {
  const palette = input.palette?.length ? input.palette : DEFAULT_PALETTE;
  const rows = input.result.rows;
  const highlighted = rows.some((r) => r.highlights !== null);
  const labels = rows.map((r) => (r.keys.length ? formatKey(r.keys[0], input.categoryType, input.categoryFormat) : input.measureNames[0] ?? ''));
  const formatter = (i: number) => (v: number | null | undefined) => formatValue(v ?? null, input.measureFormats[i]);
  const showLabels = input.options['dataLabels'] !== undefined ? input.options['dataLabels'] === true : input.kind !== 'line';
  const colorByPoint = input.options['colorByPoint'] === true && input.measureNames.length === 1;
  const onSelect = input.onSelect;

  const click: Highcharts.PointClickCallbackFunction = function (this: Highcharts.Point, event: Highcharts.PointClickEventObject) {
    const custom = this.options.custom as PointCustom | undefined;
    if (custom) onSelect(custom.keys, event.ctrlKey || event.metaKey);
  };

  const common: Highcharts.Options = {
    chart: {
      type: input.kind === 'donut' ? 'pie' : input.kind,
      animation: false,
      backgroundColor: 'transparent',
      spacing: [8, 4, 4, 4],
      style: { fontFamily: 'inherit' },
    },
    title: { text: undefined },
    credits: { enabled: false },
    colors: palette,
    accessibility: { enabled: true },
    tooltip: {
      outside: true,
      formatter: function (this: Highcharts.Point) {
        const custom = this.options.custom as PointCustom | undefined;
        const index = Number(this.series.options.id?.slice(1) ?? 0);
        const f = formatter(index);
        const name = this.series.options.id?.startsWith('h') ? input.measureNames[index] : this.series.name;
        const category = input.kind === 'pie' || input.kind === 'donut' ? this.name : String(this.category ?? '');
        const value = custom ? custom.value : (this.y ?? null);
        const share = highlighted && custom ? `<br/>Highlighted: <b>${f(custom.highlight)}</b>` : '';
        return `${category}<br/>${name}: <b>${f(value)}</b>${share}`;
      },
    },
    plotOptions: {
      series: { cursor: 'pointer', animation: false, point: { events: { click } } },
    },
  };

  if (input.kind === 'pie' || input.kind === 'donut') {
    const f = formatter(0);
    return {
      ...common,
      legend: { enabled: true, itemStyle: { color: AXIS_TEXT, fontWeight: '500' } },
      series: [{
        type: 'pie',
        id: 'm0',
        name: input.measureNames[0],
        innerSize: input.kind === 'donut' ? '60%' : '0%',
        showInLegend: true,
        dataLabels: {
          enabled: showLabels,
          formatter: function (this: Highcharts.Point) {
            return `${this.name}: ${f(this.y)}`;
          },
        },
        data: rows.map((r, j) => {
          const color = palette[j % palette.length];
          const highlight = r.highlights?.[0] ?? null;
          return {
            name: labels[j],
            y: r.values[0],
            color: highlighted && !highlight ? dim(color) : color,
            custom: { keys: r.keys, value: r.values[0], highlight } satisfies PointCustom,
          };
        }),
      }],
    };
  }

  const stacked = input.kind !== 'line';
  const series: Highcharts.SeriesOptionsType[] = [];
  input.measureNames.forEach((name, i) => {
    const color = palette[i % palette.length];
    const pointColor = (j: number) => (colorByPoint ? palette[j % palette.length] : color);
    const f = formatter(i);
    const lineLabels = { enabled: showLabels && !stacked, formatter: function (this: Highcharts.Point) { return f(this.y); } };

    series.push({
      type: input.kind,
      id: `m${i}`,
      name,
      color,
      stack: stacked ? `m${i}` : undefined,
      dataLabels: lineLabels,
      data: rows.map((r, j) => {
        const value = r.values[i];
        const highlight = r.highlights?.[i] ?? null;
        const custom: PointCustom = { keys: r.keys, value, highlight };
        if (!highlighted) return { y: value, color: pointColor(j), custom };
        return {
          y: stacked && value !== null ? value - (highlight ?? 0) : value,
          color: dim(pointColor(j)),
          marker: { fillColor: dim(pointColor(j)) },
          custom,
        };
      }),
    } as Highcharts.SeriesOptionsType);

    series.push({
      type: input.kind,
      id: `h${i}`,
      name: `${name} (highlighted)`,
      linkedTo: `m${i}`,
      color,
      stack: stacked ? `m${i}` : undefined,
      showInLegend: false,
      dataLabels: { enabled: false },
      data: rows.map((r, j) => ({
        y: highlighted ? (r.highlights?.[i] ?? null) : null,
        color: pointColor(j),
        custom: { keys: r.keys, value: r.values[i], highlight: r.highlights?.[i] ?? null } satisfies PointCustom,
      })),
    } as Highcharts.SeriesOptionsType);
  });

  const first = formatter(0);
  return {
    ...common,
    legend: { enabled: input.measureNames.length > 1, itemStyle: { color: AXIS_TEXT, fontWeight: '500' } },
    xAxis: {
      categories: labels,
      lineColor: '#DCE3ED',
      tickColor: '#DCE3ED',
      labels: { style: { color: AXIS_TEXT } },
    },
    yAxis: {
      title: { text: typeof input.options['valueAxisTitle'] === 'string' ? (input.options['valueAxisTitle'] as string) : undefined, style: { color: AXIS_TEXT } },
      gridLineColor: GRID,
      reversedStacks: true,
      labels: {
        style: { color: AXIS_TEXT },
        formatter: function () {
          return first(typeof this.value === 'number' ? this.value : Number(this.value));
        },
      },
      stackLabels: {
        enabled: showLabels && stacked,
        style: { color: AXIS_TEXT, fontWeight: '500', textOutline: 'none' },
        formatter: function () {
          return first(this.total);
        },
      },
    },
    plotOptions: {
      ...common.plotOptions,
      column: { stacking: 'normal', borderWidth: 0, borderRadius: 3, groupPadding: 0.12, pointPadding: 0.08 },
      bar: { stacking: 'normal', borderWidth: 0, borderRadius: 3, groupPadding: 0.12, pointPadding: 0.08 },
      line: { marker: { enabled: true, radius: 4 }, lineWidth: 2 },
    },
    series,
  };
}

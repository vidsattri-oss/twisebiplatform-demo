import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject } from '@angular/core';
import { HighchartsChartComponent } from 'highcharts-angular';
import type Highcharts from 'highcharts/esm/highcharts';
import { Scalar } from '@tasnim/bi/core';
import { columnOf } from '@tasnim/bi/core';
import { categoryFields, measureNames } from '@tasnim/bi/core';
import { BI_VISUAL_CONTEXT } from '@tasnim/bi/core';
import { ChartKind, buildChartOptions } from './chart-options';

const KINDS = new Set<ChartKind>(['column', 'bar', 'line', 'pie', 'donut']);

/** Column, bar, line, pie and donut visuals on Highcharts (TWise's charting library). */
@Component({
  selector: 'bi-chart-visual',
  imports: [HighchartsChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options(); as chartOptions) {
      <highcharts-chart class="chart" [options]="chartOptions" (chartInstance)="attach($event)" />
    }
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .chart { display: block; width: 100%; height: 100%; }
  `,
})
export class ChartVisualComponent {
  private readonly ctx = inject(BI_VISUAL_CONTEXT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private chart: Highcharts.Chart | null = null;

  readonly options = computed(() => {
    const result = this.ctx.result();
    const model = this.ctx.model();
    const visual = this.ctx.definition();
    const kind = visual.type as ChartKind;
    if (!result || !model || !KINDS.has(kind)) return null;
    const names = measureNames(visual);
    const category = categoryFields(visual)[0];
    const categoryColumn = category ? columnOf(model, category) : undefined;
    return buildChartOptions({
      kind,
      result,
      measureNames: names,
      measureFormats: names.map((n) => model.measures.find((m) => m.name === n)?.format),
      categoryType: category?.dateLevel ? 'text' : categoryColumn?.dataType,
      categoryFormat: categoryColumn?.format,
      options: visual.options ?? {},
      onSelect: (keys, additive) => this.ctx.select(keys, additive),
    });
  });

  constructor() {
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.chart?.reflow());
      observer.observe(this.host.nativeElement);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }

  attach(chart: Highcharts.Chart): void {
    this.chart = chart;
    // Power BI opens See records from a data point's context menu.
    chart.container.addEventListener('contextmenu', (event) => {
      const keys = (chart.hoverPoint?.options.custom as { keys?: Scalar[] } | undefined)?.keys;
      if (!keys) return;
      event.preventDefault();
      this.ctx.seeRecords(keys);
    });
  }
}

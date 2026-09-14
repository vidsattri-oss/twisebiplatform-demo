import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, map, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { SelectionService } from '../../core/selection.service';
import { DashboardChart, DashboardInfo, QueryResultRow } from '../../core/models';

interface Bar {
  /** The real group_key value (e.g. a crew_id) — what filtering/selection/drill-down key off of. */
  rawKey: string;
  /** What's shown on screen — resolved to a name where possible, otherwise same as rawKey. */
  label: string;
  value: number;
  pct: number;
}

interface ChartState {
  chart: DashboardChart;
  rows: QueryResultRow[];
  bars: Bar[];
  tableRows: Record<string, unknown>[];
  tableColumns: string[];
  loading: boolean;
  error: string | null;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly selection = inject(SelectionService);

  readonly error = signal<string | null>(null);
  readonly dashboards = signal<DashboardInfo[]>([]);
  readonly activeDashboardId = signal<number | null>(null);
  readonly charts = signal<ChartState[]>([]);

  readonly showNewDashboard = signal(false);
  readonly newDashboardName = signal('');

  readonly expanded = signal<ChartState | null>(null);
  readonly drilldown = signal<{ chart: ChartState; groupValue: string | number; rows: Record<string, unknown>[]; columns: string[] } | null>(null);

  // Best-effort label resolution for "<x>_id" group-by fields: look the id up
  // in a same-named table (crew_id -> crews.name) on the same connection.
  // Falls back to the raw id when there's no such table/column — this is a
  // display nicety, not something the query engine depends on.
  private readonly idLabelCache = new Map<string, Record<number, string>>();

  ngOnInit(): void {
    this.api.getDashboards().subscribe({
      next: (res) => {
        this.dashboards.set(res.dashboards);
        if (res.dashboards.length) this.selectDashboard(res.dashboards[0].id);
      },
      error: () => this.error.set('Could not reach the local backend. Run "npm start" in query-builder-prototype/.'),
    });
  }

  selectDashboard(id: number): void {
    this.activeDashboardId.set(id);
    this.api.getDashboardCharts(id).subscribe((res) => {
      this.charts.set(res.charts.map((chart) => ({ chart, rows: [], bars: [], tableRows: [], tableColumns: [], loading: true, error: null })));
      res.charts.forEach((c) => this.runChart(c.id));
    });
  }

  private chartState(chartId: number): ChartState | undefined {
    return this.charts().find((cs) => cs.chart.id === chartId);
  }

  // Known "<x>_id" -> lookup table label mappings. Not a general FK resolver
  // (that would need real foreign-key metadata this demo schema doesn't
  // expose) — just the specific case this app's own tables need.
  private static readonly ID_LOOKUPS: Record<string, { table: string; idCol: string; labelCol: string }> = {
    crew_id: { table: 'crews', idCol: 'id', labelCol: 'name' },
  };

  private loadIdLabels(connectionId: number, groupBy: string): Observable<Record<number, string> | null> {
    const lookup = DashboardComponent.ID_LOOKUPS[groupBy];
    if (!lookup) return of(null);
    const cacheKey = `${connectionId}:${groupBy}`;
    const cached = this.idLabelCache.get(cacheKey);
    if (cached) return of(cached);
    return this.api.getTablePreview(connectionId, lookup.table).pipe(
      map((res) => {
        const map: Record<number, string> = {};
        for (const row of res.rows) map[row[lookup.idCol] as number] = row[lookup.labelCol] as string;
        this.idLabelCache.set(cacheKey, map);
        return map;
      }),
    );
  }

  /** The filters every chart type shares: its own base filters, plus the dashboard's live cross-filter selection when it applies to this chart's connection+table — this is what "all filters are linked" means concretely. */
  private linkedFilters(cfg: DashboardChart['config']): DashboardChart['config']['filters'] {
    const extra = [...cfg.filters];
    if (this.selection.appliesTo(cfg.connectionId, cfg.table)) {
      const sel = this.selection.current()!;
      extra.push({ field: sel.groupBy, op: '=', value: String(sel.value) });
    }
    return extra;
  }

  runChart(chartId: number): void {
    const cs = this.chartState(chartId);
    if (!cs) return;
    cs.loading = true;
    cs.error = null;
    this.charts.set([...this.charts()]);

    const cfg = cs.chart.config;
    const extraFilters = this.linkedFilters(cfg);

    if (cs.chart.chartType === 'table') {
      // A Table visual (Power BI's "add a table, everything else still
      // filters it") shows the real detail rows behind whatever's
      // currently selected elsewhere on the dashboard — not an aggregate.
      this.api.drilldown({ connectionId: cfg.connectionId, table: cfg.table, filters: extraFilters }).subscribe({
        next: (res) => {
          cs.tableRows = res.rows;
          cs.tableColumns = res.rows.length ? Object.keys(res.rows[0]) : [];
          cs.loading = false;
          this.charts.set([...this.charts()]);
        },
        error: (err) => {
          cs.error = err?.error?.error ?? 'Query failed';
          cs.loading = false;
          this.charts.set([...this.charts()]);
        },
      });
      return;
    }

    this.loadIdLabels(cfg.connectionId, cfg.groupBy ?? '').subscribe((labels) => {
      this.api.runQuery({ ...cfg, filters: extraFilters }).subscribe({
        next: (res) => {
          const max = Math.max(...res.rows.map((r) => r.value ?? 0), 0.0001);
          cs.rows = res.rows;
          cs.bars = res.rows.map((r) => {
            const rawKey = String(r.group_key ?? cfg.table);
            const label = (labels && r.group_key !== undefined ? labels[Number(r.group_key)] : undefined) ?? rawKey;
            return { rawKey, label, value: r.value ?? 0, pct: Math.max(3, Math.round(((r.value ?? 0) / max) * 100)) };
          });
          cs.loading = false;
          this.charts.set([...this.charts()]);
        },
        error: (err) => {
          cs.error = err?.error?.error ?? 'Query failed';
          cs.loading = false;
          this.charts.set([...this.charts()]);
        },
      });
    });
  }

  displayValue(cs: ChartState, v: number): string {
    return cs.chart.config.metric.type === 'ratio' && v < 1.5 ? `${Math.round(v * 100)}%` : v.toFixed(1);
  }

  onBarClick(cs: ChartState, rawKey: string): void {
    const cfg = cs.chart.config;
    if (!cfg.groupBy) return;
    this.selection.select({ connectionId: cfg.connectionId, table: cfg.table, groupBy: cfg.groupBy, value: rawKey });
    this.charts().forEach((c) => this.runChart(c.chart.id)); // re-run every chart on this dashboard against the new selection
  }

  clearSelection(): void {
    this.selection.clear();
    this.charts().forEach((c) => this.runChart(c.chart.id));
  }

  expand(cs: ChartState): void {
    this.expanded.set(cs);
  }

  closeExpand(): void {
    this.expanded.set(null);
  }

  openDrilldown(cs: ChartState, rawKey: string, label: string): void {
    const cfg = cs.chart.config;
    this.api
      .drilldown({
        connectionId: cfg.connectionId,
        table: cfg.table,
        groupBy: cfg.groupBy ?? undefined,
        groupValue: rawKey,
        filters: cfg.filters,
      })
      .subscribe((res) => {
        const columns = res.rows.length ? Object.keys(res.rows[0]) : [];
        this.drilldown.set({ chart: cs, groupValue: label, rows: res.rows, columns });
      });
  }

  closeDrilldown(): void {
    this.drilldown.set(null);
  }

  deleteChart(cs: ChartState): void {
    const dashId = this.activeDashboardId();
    if (!dashId) return;
    this.api.deleteDashboardChart(dashId, cs.chart.id).subscribe(() => this.selectDashboard(dashId));
  }

  openNewDashboard(): void {
    this.newDashboardName.set('');
    this.showNewDashboard.set(true);
  }

  createDashboard(): void {
    const name = this.newDashboardName().trim();
    if (!name) return;
    this.api.addDashboard(name).subscribe((res) => {
      this.showNewDashboard.set(false);
      this.api.getDashboards().subscribe((dres) => {
        this.dashboards.set(dres.dashboards);
        this.selectDashboard(res.id);
      });
    });
  }

  deleteDashboard(id: number): void {
    if (id === this.dashboards()[0]?.id) return; // guard the default; server also refuses id 1
    this.api.deleteDashboard(id).subscribe(() => {
      this.api.getDashboards().subscribe((res) => {
        this.dashboards.set(res.dashboards);
        this.selectDashboard(res.dashboards[0].id);
      });
    });
  }
}

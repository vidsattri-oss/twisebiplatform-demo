import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { SelectionService } from '../../core/selection.service';
import { EditChartService } from '../../core/edit-chart.service';
import { classifyColumn, FieldKind } from '../../core/column-type';
import { ColumnInfo, DashboardChart, DashboardInfo, FilterOp, QueryResultRow } from '../../core/models';

/** A dashboard-level filter — applied to every chart whose own table has a column with this name, regardless of connection. */
interface DashFilter {
  field: string;
  kind: FieldKind;
  op: FilterOp;
  value: string;
}

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
  private readonly router = inject(Router);
  private readonly editChart = inject(EditChartService);
  readonly selection = inject(SelectionService);

  readonly error = signal<string | null>(null);
  readonly dashboards = signal<DashboardInfo[]>([]);
  readonly activeDashboardId = signal<number | null>(null);
  readonly charts = signal<ChartState[]>([]);

  readonly showNewDashboard = signal(false);
  readonly newDashboardName = signal('');

  // Inline rename — dashboard tabs and chart titles are editable in place
  // (double-click to enter, Enter/blur to save, Escape to cancel).
  readonly editingDashboardId = signal<number | null>(null);
  readonly editDashboardName = signal('');
  readonly editingChartId = signal<number | null>(null);
  readonly editChartTitle = signal('');

  readonly expanded = signal<ChartState | null>(null);
  readonly drilldown = signal<{ chart: ChartState; groupValue: string | number; rows: Record<string, unknown>[]; columns: string[] } | null>(null);

  // Dashboard-level filter bar — cross-connection by design: a filter applies
  // to any chart whose own table has a column with the same name, whatever
  // connection that chart is on. Matched by field name only (no declared
  // relationships exist yet), so it's deliberately scoped to columns that
  // are already schema-identical across sources (e.g. "region").
  readonly ops: FilterOp[] = ['=', '!=', '>', '<', '>=', '<='];
  readonly chartSchemas = signal<Record<string, ColumnInfo[]>>({}); // key: `${connectionId}:${table}`
  readonly dashFilters = signal<DashFilter[]>([]);
  readonly newFilterField = signal('');
  readonly newFilterOp = signal<FilterOp>('=');
  readonly newFilterValue = signal('');
  readonly filterDistinct = signal<Record<string, (string | number)[]>>({});
  readonly filterRange = signal<Record<string, { min: number | string; max: number | string }>>({});

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
    this.dashFilters.set([]);
    this.newFilterField.set('');
    this.api.getDashboardCharts(id).subscribe((res) => {
      this.charts.set(res.charts.map((chart) => ({ chart, rows: [], bars: [], tableRows: [], tableColumns: [], loading: true, error: null })));
      this.loadChartSchemas(res.charts);
      res.charts.forEach((c) => this.runChart(c.id));
    });
  }

  /** Fetches (and caches, by connectionId+table) the schema of every chart on the dashboard — this is how a dashboard filter knows which charts it applies to. */
  private loadChartSchemas(charts: DashboardChart[]): void {
    const known = this.chartSchemas();
    const toFetch = new Map<string, { connectionId: number; table: string }>();
    charts.forEach((c) => {
      const key = `${c.config.connectionId}:${c.config.table}`;
      if (!known[key]) toFetch.set(key, { connectionId: c.config.connectionId, table: c.config.table });
    });
    toFetch.forEach((v, key) => {
      this.api.getTableSchema(v.connectionId, v.table).subscribe((res) => {
        this.chartSchemas.update((m) => ({ ...m, [key]: res.columns }));
      });
    });
  }

  /** Every column name available across this dashboard's charts, deduped — the pool a new filter can be built from. */
  availableFilterFields(): { name: string; kind: FieldKind }[] {
    const schemas = this.chartSchemas();
    const seen = new Map<string, FieldKind>();
    this.charts().forEach((cs) => {
      const key = `${cs.chart.config.connectionId}:${cs.chart.config.table}`;
      (schemas[key] ?? []).forEach((c) => {
        if (!seen.has(c.name)) seen.set(c.name, classifyColumn(c.name, c.type));
      });
    });
    return Array.from(seen.entries()).map(([name, kind]) => ({ name, kind }));
  }

  fieldKindFor(field: string): FieldKind {
    return this.availableFilterFields().find((f) => f.name === field)?.kind ?? 'text';
  }

  private findSourceForField(field: string): { connectionId: number; table: string } | null {
    const schemas = this.chartSchemas();
    for (const cs of this.charts()) {
      const key = `${cs.chart.config.connectionId}:${cs.chart.config.table}`;
      if ((schemas[key] ?? []).some((c) => c.name === field)) {
        return { connectionId: cs.chart.config.connectionId, table: cs.chart.config.table };
      }
    }
    return null;
  }

  onNewFilterFieldChange(): void {
    const field = this.newFilterField();
    this.newFilterValue.set('');
    if (!field) return;
    const kind = this.fieldKindFor(field);
    const source = this.findSourceForField(field);
    if (!source) return;
    if (kind === 'text') {
      if (this.filterDistinct()[field]) return;
      this.api.getColumnDistinct(source.connectionId, source.table, field).subscribe((res) => {
        this.filterDistinct.update((m) => ({ ...m, [field]: res.values }));
      });
    } else {
      if (this.filterRange()[field]) return;
      this.api.getColumnRange(source.connectionId, source.table, field).subscribe((res) => {
        this.filterRange.update((m) => ({ ...m, [field]: res }));
        if (kind === 'number' && !this.newFilterValue()) this.newFilterValue.set(String(res.min));
      });
    }
  }

  addDashFilter(): void {
    const field = this.newFilterField();
    const value = this.newFilterValue();
    if (!field || !value) return;
    this.dashFilters.update((fs) => [...fs, { field, kind: this.fieldKindFor(field), op: this.newFilterOp(), value }]);
    this.newFilterField.set('');
    this.newFilterOp.set('=');
    this.newFilterValue.set('');
    this.charts().forEach((c) => this.runChart(c.chart.id));
  }

  removeDashFilter(i: number): void {
    this.dashFilters.update((fs) => fs.filter((_, idx) => idx !== i));
    this.charts().forEach((c) => this.runChart(c.chart.id));
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
    // Cross-connection filter bar: applies to any chart whose OWN table has
    // this column, regardless of which connection that chart is on.
    const cols = this.chartSchemas()[`${cfg.connectionId}:${cfg.table}`] ?? [];
    const colNames = new Set(cols.map((c) => c.name));
    this.dashFilters().forEach((f) => {
      if (colNames.has(f.field)) extra.push({ field: f.field, op: f.op, value: f.value });
    });
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

  /** Power BI's actual pattern: left-click a data point cross-filters (onBarClick); right-click opens "See records" for just that point. */
  onBarContextMenu(event: MouseEvent, cs: ChartState, rawKey: string, label: string): void {
    event.preventDefault();
    this.openDrilldown(cs, rawKey, label);
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

  startRenameDashboard(d: DashboardInfo): void {
    this.editingDashboardId.set(d.id);
    this.editDashboardName.set(d.name);
  }

  saveRenameDashboard(d: DashboardInfo): void {
    const name = this.editDashboardName().trim();
    this.editingDashboardId.set(null);
    if (!name || name === d.name) return;
    this.api.renameDashboard(d.id, name).subscribe(() => {
      this.dashboards.update((ds) => ds.map((x) => (x.id === d.id ? { ...x, name } : x)));
    });
  }

  startRenameChart(cs: ChartState): void {
    this.editingChartId.set(cs.chart.id);
    this.editChartTitle.set(cs.chart.title);
  }

  saveRenameChart(cs: ChartState): void {
    const title = this.editChartTitle().trim();
    this.editingChartId.set(null);
    const dashId = this.activeDashboardId();
    if (!title || title === cs.chart.title || !dashId) return;
    this.api.updateDashboardChart(dashId, cs.chart.id, { title }).subscribe(() => {
      cs.chart = { ...cs.chart, title };
      this.charts.set([...this.charts()]);
    });
  }

  /** Hands the chart's full config to Query Builder and navigates there to edit it — the config editor already lives there, so this reuses it instead of duplicating it in-place. */
  editChartQuery(cs: ChartState): void {
    const dashboardId = this.activeDashboardId();
    if (!dashboardId) return;
    this.editChart.requestEdit({
      dashboardId,
      chartId: cs.chart.id,
      title: cs.chart.title,
      chartType: cs.chart.chartType,
      config: cs.chart.config,
    });
    this.router.navigate(['/query-builder']);
  }

  /** The dashboard always initiates adding a visual — this hands Query Builder the target dashboard and navigates there, rather than Query Builder asking "which dashboard?" after the fact. */
  addVisual(): void {
    const dashboardId = this.activeDashboardId();
    const dashboard = this.dashboards().find((d) => d.id === dashboardId);
    if (!dashboardId || !dashboard) return;
    this.editChart.requestAdd({ dashboardId, dashboardName: dashboard.name });
    this.router.navigate(['/query-builder']);
  }
}

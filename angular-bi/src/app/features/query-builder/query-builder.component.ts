import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { EditChartService, PendingChartAdd, PendingChartEdit } from '../../core/edit-chart.service';
import { classifyColumn, FieldKind } from '../../core/column-type';
import { AggFn, ColumnInfo, ConnectionInfo, FilterOp, Metric, QueryConfig, QueryJoin, QueryResultRow, SavedMeasure } from '../../core/models';
import { FormulaModeComponent } from './formula-mode.component';
import { AiPlaceholderComponent } from './ai-placeholder.component';

type Mode = 'visual' | 'formula' | 'ai';
type ChartType = 'bar' | 'line' | 'pie' | 'table';

interface FilterRow {
  field: string;
  op: FilterOp;
  value: string;
}

const PIE_COLORS = ['#6C63F5', '#3D63E8', '#17A567', '#F5811F', '#B0413E', '#5850E6'];

@Component({
  selector: 'app-query-builder',
  standalone: true,
  imports: [FormsModule, DecimalPipe, FormulaModeComponent, AiPlaceholderComponent],
  templateUrl: './query-builder.component.html',
  styleUrl: './query-builder.component.css',
})
export class QueryBuilderComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly editChartService = inject(EditChartService);

  /** Set when arriving here via Dashboard's "Edit query" action — swaps the add-chart action for "Update chart". */
  readonly editingChart = signal<PendingChartEdit | null>(null);
  /** Set when arriving here via Dashboard's "+ Add Visual" action — the only way to add a chart to a dashboard; there is no dashboard-picker here, the dashboard always initiates. */
  readonly addingToDashboard = signal<PendingChartAdd | null>(null);

  readonly aggs: AggFn[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
  readonly ops: FilterOp[] = ['=', '!=', '>', '<', '>=', '<='];

  readonly mode = signal<Mode>('visual');
  readonly chartType = signal<ChartType>('bar');

  readonly connections = signal<ConnectionInfo[]>([]);
  readonly connectionId = signal(1);
  readonly table = signal('tasks');
  readonly metricType = signal<'agg' | 'ratio'>('ratio');
  readonly agg = signal<AggFn>('SUM');
  readonly field = signal('actual_hours');
  readonly numerator = signal('actual_quantity');
  readonly denominator = signal('planned_quantity');
  readonly groupBy = signal('crew_id');
  readonly filters = signal<FilterRow[]>([{ field: 'status', op: '=', value: 'Active' }]);

  readonly schema = signal<string[]>([]);
  readonly schemaCols = signal<ColumnInfo[]>([]);
  readonly crewNames = signal<Record<number, string>>({});

  // Per-field filter widget data — a text field gets a dropdown of its real
  // distinct values, a number/date field gets its real min/max — fetched
  // on demand and cached per field name so re-selecting a field is instant.
  readonly filterDistinct = signal<Record<string, (string | number)[]>>({});
  readonly filterRange = signal<Record<string, { min: number | string; max: number | string }>>({});

  // Cross-connection join (optional) — see server.js: real via SQLite ATTACH,
  // only possible because both sides are SQLite files.
  readonly joinEnabled = signal(false);
  readonly joinConnectionId = signal<number | null>(null);
  readonly joinTable = signal('');
  readonly joinSchema = signal<string[]>([]);
  readonly joinLeftField = signal('');
  readonly joinRightField = signal('');

  readonly rows = signal<QueryResultRow[]>([]);
  readonly tableRows = signal<Record<string, unknown>[]>([]);
  readonly tableColumns = signal<string[]>([]);
  readonly sql = signal<string>('');
  readonly runError = signal<string | null>(null);
  readonly runOk = signal<string | null>(null);

  readonly measureName = signal('');
  readonly measures = signal<SavedMeasure[]>([]);

  readonly dashboardChartTitle = signal('');

  readonly maxValue = computed(() => Math.max(...this.rows().map((r) => r.value ?? 0), 0.0001));

  readonly pieSlices = computed(() => {
    const rows = this.rows();
    const total = rows.reduce((s, r) => s + (r.value ?? 0), 0) || 1;
    let acc = 0;
    return rows.map((r, i) => {
      const pct = ((r.value ?? 0) / total) * 100;
      const slice = { color: PIE_COLORS[i % PIE_COLORS.length], from: acc, to: acc + pct, label: this.groupLabel(r), pct };
      acc += pct;
      return slice;
    });
  });

  readonly linePoints = computed(() => {
    const rows = this.rows();
    const max = this.maxValue();
    if (rows.length <= 1) return '10,80 290,80';
    return rows
      .map((r, i) => {
        const x = (i / (rows.length - 1)) * 280 + 10;
        const y = 150 - ((r.value ?? 0) / max) * 130;
        return `${x},${y}`;
      })
      .join(' ');
  });

  linePointX(i: number): number {
    const n = this.rows().length;
    return n > 1 ? (i / (n - 1)) * 280 + 10 : 150;
  }

  linePointY(v: number | null): number {
    return 150 - ((v ?? 0) / this.maxValue()) * 130;
  }

  readonly pieGradient = computed(() => {
    const slices = this.pieSlices();
    if (!slices.length) return 'conic-gradient(#EEF0F7 0% 100%)';
    return `conic-gradient(${slices.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`;
  });

  ngOnInit(): void {
    this.api.getConnections().subscribe((res) => {
      this.connections.set(res.connections);
    });
    this.api.getTablePreview(1, 'crews').subscribe((res) => {
      const names: Record<number, string> = {};
      for (const row of res.rows) names[row['id'] as number] = row['name'] as string;
      this.crewNames.set(names);
    });
    this.loadMeasures();

    const pending = this.editChartService.consume();
    if (pending?.mode === 'edit') {
      this.applyChartEdit(pending);
    } else if (pending?.mode === 'add') {
      this.addingToDashboard.set(pending);
      this.dashboardChartTitle.set('');
      this.loadSchema();
      this.run();
    } else {
      this.loadSchema();
      this.run();
    }
  }

  /** Populates the form from an existing dashboard chart's config — same idea as loadMeasure(), plus join fields and chart type. */
  private applyChartEdit(edit: PendingChartEdit): void {
    this.editingChart.set(edit);
    this.chartType.set(edit.chartType);
    this.dashboardChartTitle.set(edit.title);

    const cfg = edit.config;
    this.connectionId.set(cfg.connectionId);
    this.table.set(cfg.table);
    this.metricType.set(cfg.metric.type);
    this.agg.set(cfg.metric.agg);
    if (cfg.metric.type === 'agg') {
      this.field.set(cfg.metric.field);
    } else {
      this.numerator.set(cfg.metric.numerator);
      this.denominator.set(cfg.metric.denominator);
    }
    this.groupBy.set(cfg.groupBy ?? '');
    this.filters.set(cfg.filters);
    if (cfg.join) {
      this.joinEnabled.set(true);
      this.joinConnectionId.set(cfg.join.connectionId);
      this.joinTable.set(cfg.join.table);
      this.joinLeftField.set(cfg.join.leftField);
      this.joinRightField.set(cfg.join.rightField);
      this.onJoinTableChange();
    } else {
      this.joinEnabled.set(false);
    }

    this.api.getTableSchema(cfg.connectionId, cfg.table).subscribe((res) => {
      this.schema.set(res.columns.map((c) => c.name));
      this.schemaCols.set(res.columns);
      this.filters().forEach((f) => this.ensureFilterOptions(f.field));
    });
    this.run();
  }

  currentTables(): { name: string }[] {
    return this.connections().find((c) => c.id === this.connectionId())?.tables ?? [];
  }

  loadSchema(): void {
    this.api.getTableSchema(this.connectionId(), this.table()).subscribe((res) => {
      this.schema.set(res.columns.map((c) => c.name));
      this.schemaCols.set(res.columns);
      this.filters().forEach((f) => this.ensureFilterOptions(f.field));
    });
  }

  fieldKind(name: string): FieldKind {
    const col = this.schemaCols().find((c) => c.name === name);
    return classifyColumn(name, col?.type ?? '');
  }

  onFilterFieldChange(i: number): void {
    const f = this.filters()[i];
    if (f) this.ensureFilterOptions(f.field);
  }

  private ensureFilterOptions(field: string): void {
    if (!field) return;
    const kind = this.fieldKind(field);
    if (kind === 'text') {
      if (this.filterDistinct()[field]) return;
      this.api.getColumnDistinct(this.connectionId(), this.table(), field).subscribe((res) => {
        this.filterDistinct.update((m) => ({ ...m, [field]: res.values }));
      });
    } else {
      if (this.filterRange()[field]) return;
      this.api.getColumnRange(this.connectionId(), this.table(), field).subscribe((res) => {
        this.filterRange.update((m) => ({ ...m, [field]: res }));
        if (kind === 'number') {
          this.filters.update((fs) => fs.map((f2) => (f2.field === field && !f2.value ? { ...f2, value: String(res.min) } : f2)));
        }
      });
    }
  }

  onConnectionChange(): void {
    const tables = this.currentTables();
    this.table.set(tables[0]?.name ?? '');
    this.onTableChange();
  }

  /**
   * Switching tables invalidates every column reference the form is
   * currently holding — this resets them to the new table's own columns
   * once its schema loads, rather than leaving stale references (e.g.
   * "actual_hours" selected against a table that has no such column).
   */
  onTableChange(): void {
    this.filters.set([]);
    this.groupBy.set('');
    this.filterDistinct.set({});
    this.filterRange.set({});
    this.api.getTableSchema(this.connectionId(), this.table()).subscribe((res) => {
      const cols = res.columns.map((c) => c.name);
      this.schema.set(cols);
      this.schemaCols.set(res.columns);
      const first = cols[0] ?? '';
      this.field.set(first);
      this.numerator.set(first);
      this.denominator.set(cols[1] ?? first);
    });
  }

  addFilter(): void {
    const f = this.schema()[0] ?? '';
    this.filters.update((fs) => [...fs, { field: f, op: '=', value: '' }]);
    this.ensureFilterOptions(f);
  }

  removeFilter(i: number): void {
    this.filters.update((fs) => fs.filter((_, idx) => idx !== i));
  }

  otherConnections(): ConnectionInfo[] {
    return this.connections().filter((c) => c.id !== this.connectionId());
  }

  joinTables(): { name: string }[] {
    return this.connections().find((c) => c.id === this.joinConnectionId())?.tables ?? [];
  }

  toggleJoin(): void {
    this.joinEnabled.update((v) => !v);
    if (this.joinEnabled() && this.otherConnections().length) {
      this.onJoinConnectionChange(this.otherConnections()[0].id);
    } else {
      this.joinConnectionId.set(null);
    }
  }

  onJoinConnectionChange(id: number): void {
    this.joinConnectionId.set(id);
    const tables = this.connections().find((c) => c.id === id)?.tables ?? [];
    this.joinTable.set(tables[0]?.name ?? '');
    this.onJoinTableChange();
  }

  onJoinTableChange(): void {
    const connId = this.joinConnectionId();
    if (connId == null || !this.joinTable()) return;
    this.api.getTableSchema(connId, this.joinTable()).subscribe((res) => {
      const cols = res.columns.map((c) => c.name);
      this.joinSchema.set(cols);
      this.joinRightField.set(cols[0] ?? '');
    });
  }

  buildConfig(): QueryConfig {
    const metric: Metric =
      this.metricType() === 'agg'
        ? { type: 'agg', agg: this.agg(), field: this.field() }
        : { type: 'ratio', agg: this.agg(), numerator: this.numerator(), denominator: this.denominator() };

    let join: QueryJoin | null = null;
    if (this.joinEnabled() && this.joinConnectionId() != null && this.joinTable() && this.joinLeftField() && this.joinRightField()) {
      join = {
        connectionId: this.joinConnectionId()!,
        table: this.joinTable(),
        leftField: this.joinLeftField(),
        rightField: this.joinRightField(),
      };
    }

    return {
      connectionId: this.connectionId(),
      table: this.table(),
      groupBy: this.groupBy() || null,
      filters: this.filters().filter((f) => f.value !== ''),
      metric,
      join,
    };
  }

  run(): void {
    this.runError.set(null);
    this.runOk.set(null);
    const cfg = this.buildConfig();
    this.api.runQuery(cfg).subscribe({
      next: (res) => {
        this.rows.set(res.rows);
        this.sql.set(this.displaySql(res.sql, res.params));
        this.runOk.set(`${res.rows.length} row(s) returned from the live SQLite database.`);
      },
      error: (err) => {
        this.runError.set(err?.error?.error ?? 'Query failed');
      },
    });
    // Fetched alongside the aggregate so switching to the Table view is
    // instant — this is the same detail-row query a Table chart added to a
    // dashboard runs, letting the Live Preview show exactly what you'd get.
    this.api.drilldown({ connectionId: cfg.connectionId, table: cfg.table, filters: cfg.filters }).subscribe((res) => {
      this.tableRows.set(res.rows);
      this.tableColumns.set(res.rows.length ? Object.keys(res.rows[0]) : []);
    });
  }

  private displaySql(sql: string, params: unknown[]): string {
    let i = 0;
    return sql.replace(/\?/g, () => {
      const v = params[i++];
      return typeof v === 'string' ? `'${v}'` : String(v);
    });
  }

  groupLabel(row: QueryResultRow): string {
    const key = row.group_key;
    if (key === undefined) return this.table();
    if (this.connectionId() === 1 && (this.table() === 'tasks' || this.table() === 'equipment') && this.groupBy() === 'crew_id') {
      return this.crewNames()[Number(key)] ?? String(key);
    }
    return String(key);
  }

  displayValue(v: number | null): string {
    if (v == null) return '—';
    return v < 1.5 && this.metricType() === 'ratio' ? `${Math.round(v * 100)}%` : v.toFixed(1);
  }

  saveMeasure(): void {
    this.runError.set(null);
    this.runOk.set(null);
    const name = this.measureName().trim();
    if (!name) {
      this.runError.set('Give the measure a name first.');
      return;
    }
    this.api.saveMeasure(name, this.buildConfig()).subscribe({
      next: () => {
        this.runOk.set(`Saved "${name}" to the measures table.`);
        this.measureName.set('');
        this.loadMeasures();
      },
      error: (err) => this.runError.set(err?.error?.error ?? 'Save failed'),
    });
  }

  loadMeasures(): void {
    this.api.getMeasures().subscribe((res) => this.measures.set(res.measures));
  }

  deleteMeasure(id: number): void {
    this.api.deleteMeasure(id).subscribe(() => this.loadMeasures());
  }

  loadMeasure(m: SavedMeasure): void {
    this.connectionId.set(m.config.connectionId);
    this.table.set(m.config.table);
    this.metricType.set(m.config.metric.type);
    this.agg.set(m.config.metric.agg);
    if (m.config.metric.type === 'agg') {
      this.field.set(m.config.metric.field);
    } else {
      this.numerator.set(m.config.metric.numerator);
      this.denominator.set(m.config.metric.denominator);
    }
    this.groupBy.set(m.config.groupBy ?? '');
    this.filters.set(m.config.filters);
    if (m.config.join) {
      this.joinEnabled.set(true);
      this.joinConnectionId.set(m.config.join.connectionId);
      this.joinTable.set(m.config.join.table);
      this.joinLeftField.set(m.config.join.leftField);
      this.joinRightField.set(m.config.join.rightField);
    } else {
      this.joinEnabled.set(false);
    }
    this.filterDistinct.set({});
    this.filterRange.set({});
    this.loadSchema();
    this.run();
  }

  addChartToDashboard(): void {
    this.runError.set(null);
    this.runOk.set(null);
    const target = this.addingToDashboard();
    if (!target) return;
    const title = this.dashboardChartTitle().trim() || `${this.table()} chart`;
    this.api.addDashboardChart(target.dashboardId, title, this.chartType(), this.buildConfig()).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => this.runError.set(err?.error?.error ?? 'Could not add chart'),
    });
  }

  cancelAddToDashboard(): void {
    this.addingToDashboard.set(null);
    this.router.navigate(['/dashboard']);
  }

  saveChartEdit(): void {
    this.runError.set(null);
    this.runOk.set(null);
    const edit = this.editingChart();
    if (!edit) return;
    const title = this.dashboardChartTitle().trim() || edit.title;
    this.api.updateDashboardChart(edit.dashboardId, edit.chartId, { title, chartType: this.chartType(), config: this.buildConfig() }).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => this.runError.set(err?.error?.error ?? 'Could not update chart'),
    });
  }

  cancelChartEdit(): void {
    this.editingChart.set(null);
    this.router.navigate(['/dashboard']);
  }
}

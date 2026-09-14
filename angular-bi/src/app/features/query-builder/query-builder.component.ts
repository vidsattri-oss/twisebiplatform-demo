import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { AggFn, FilterOp, Metric, QueryConfig, QueryResultRow, SavedMeasure } from '../../core/models';
import { FormulaModeComponent } from './formula-mode.component';
import { AiPlaceholderComponent } from './ai-placeholder.component';

type Mode = 'visual' | 'formula' | 'ai';
type ChartType = 'bar' | 'line' | 'pie';

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

  readonly tables = ['tasks', 'crews', 'equipment'];
  readonly aggs: AggFn[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
  readonly ops: FilterOp[] = ['=', '!=', '>', '<', '>=', '<='];

  readonly mode = signal<Mode>('visual');
  readonly chartType = signal<ChartType>('bar');

  readonly table = signal('tasks');
  readonly metricType = signal<'agg' | 'ratio'>('ratio');
  readonly agg = signal<AggFn>('SUM');
  readonly field = signal('actual_hours');
  readonly numerator = signal('actual_quantity');
  readonly denominator = signal('planned_quantity');
  readonly groupBy = signal('crew_id');
  readonly filters = signal<FilterRow[]>([{ field: 'status', op: '=', value: 'Active' }]);

  readonly schema = signal<string[]>([]);
  readonly crewNames = signal<Record<number, string>>({});

  readonly rows = signal<QueryResultRow[]>([]);
  readonly sql = signal<string>('');
  readonly runError = signal<string | null>(null);
  readonly runOk = signal<string | null>(null);

  readonly measureName = signal('');
  readonly measures = signal<SavedMeasure[]>([]);

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
    this.api.getTablePreview('crews').subscribe((res) => {
      const names: Record<number, string> = {};
      for (const row of res.rows) names[row['id'] as number] = row['name'] as string;
      this.crewNames.set(names);
    });
    this.loadSchema();
    this.loadMeasures();
    this.run();
  }

  loadSchema(): void {
    this.api.getTableSchema(this.table()).subscribe((res) => this.schema.set(res.columns.map((c) => c.name)));
  }

  onTableChange(): void {
    this.filters.set([]);
    this.groupBy.set('');
    this.loadSchema();
  }

  addFilter(): void {
    const f = this.schema()[0] ?? '';
    this.filters.update((fs) => [...fs, { field: f, op: '=', value: '' }]);
  }

  removeFilter(i: number): void {
    this.filters.update((fs) => fs.filter((_, idx) => idx !== i));
  }

  buildConfig(): QueryConfig {
    const metric: Metric =
      this.metricType() === 'agg'
        ? { type: 'agg', agg: this.agg(), field: this.field() }
        : { type: 'ratio', agg: this.agg(), numerator: this.numerator(), denominator: this.denominator() };
    return {
      table: this.table(),
      groupBy: this.groupBy() || null,
      filters: this.filters().filter((f) => f.value !== ''),
      metric,
    };
  }

  run(): void {
    this.runError.set(null);
    this.runOk.set(null);
    this.api.runQuery(this.buildConfig()).subscribe({
      next: (res) => {
        this.rows.set(res.rows);
        this.sql.set(this.displaySql(res.sql, res.params));
        this.runOk.set(`${res.rows.length} row(s) returned from the live SQLite database.`);
      },
      error: (err) => {
        this.runError.set(err?.error?.error ?? 'Query failed');
      },
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
    if ((this.table() === 'tasks' || this.table() === 'equipment') && this.groupBy() === 'crew_id') {
      return this.crewNames()[Number(key)] ?? String(key);
    }
    return String(key);
  }

  displayValue(v: number | null): string {
    if (v == null) return '—';
    return v < 1.5 && this.metricType() === 'ratio' ? `${Math.round(v * 100)}%` : v.toFixed(1);
  }

  saveMeasure(): void {
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
    this.loadSchema();
    this.run();
  }
}

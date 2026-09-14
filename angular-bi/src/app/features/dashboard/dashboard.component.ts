import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { SelectionService } from '../../core/selection.service';
import { QueryResultRow } from '../../core/models';

interface Bar {
  key: string;
  label: string;
  value: number;
  pct: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly selection = inject(SelectionService);

  readonly error = signal<string | null>(null);
  readonly crewNames = signal<Record<number, string>>({});
  readonly crewIdByName = signal<Record<string, number>>({});

  readonly productivityRows = signal<QueryResultRow[]>([]);
  readonly statusRows = signal<QueryResultRow[]>([]);
  readonly statusLoading = signal(false);

  readonly productivityBars = computed<Bar[]>(() => {
    const rows = this.productivityRows();
    const names = this.crewNames();
    const max = Math.max(...rows.map((r) => r.value ?? 0), 0.0001);
    return rows.map((r) => ({
      key: names[Number(r.group_key)] ?? String(r.group_key),
      label: names[Number(r.group_key)] ?? String(r.group_key),
      value: r.value ?? 0,
      pct: Math.max(3, Math.round(((r.value ?? 0) / max) * 100)),
    }));
  });

  readonly statusBars = computed<Bar[]>(() => {
    const rows = this.statusRows();
    const max = Math.max(...rows.map((r) => r.value ?? 0), 0.0001);
    return rows.map((r) => ({
      key: String(r.group_key),
      label: String(r.group_key),
      value: r.value ?? 0,
      pct: Math.max(3, Math.round(((r.value ?? 0) / max) * 100)),
    }));
  });

  ngOnInit(): void {
    this.api.getTablePreview('crews').subscribe((res) => {
      const names: Record<number, string> = {};
      const ids: Record<string, number> = {};
      for (const row of res.rows) {
        names[row['id'] as number] = row['name'] as string;
        ids[row['name'] as string] = row['id'] as number;
      }
      this.crewNames.set(names);
      this.crewIdByName.set(ids);
      this.loadProductivity();
      this.loadStatusCounts();
    });
  }

  private loadProductivity(): void {
    this.api
      .runQuery({
        table: 'tasks',
        groupBy: 'crew_id',
        filters: [{ field: 'status', op: '=', value: 'Active' }],
        metric: { type: 'ratio', agg: 'SUM', numerator: 'actual_quantity', denominator: 'planned_quantity' },
      })
      .subscribe({
        next: (res) => this.productivityRows.set(res.rows),
        error: () => this.error.set('Could not reach the local backend. Run "npm start" in query-builder-prototype/.'),
      });
  }

  private loadStatusCounts(): void {
    this.statusLoading.set(true);
    const selectedCrew = this.selection.selected();
    const crewId = selectedCrew ? this.crewIdByName()[selectedCrew] : undefined;
    const filters = crewId !== undefined ? [{ field: 'crew_id', op: '=' as const, value: String(crewId) }] : [];

    this.api
      .runQuery({ table: 'tasks', groupBy: 'status', filters, metric: { type: 'agg', agg: 'COUNT', field: 'id' } })
      .subscribe({
        next: (res) => {
          this.statusRows.set(res.rows);
          this.statusLoading.set(false);
        },
        error: () => {
          this.error.set('Could not reach the local backend.');
          this.statusLoading.set(false);
        },
      });
  }

  onBarClick(crewLabel: string, event: MouseEvent): void {
    this.selection.select(crewLabel, event.ctrlKey || event.metaKey);
    this.loadStatusCounts(); // re-query the second chart filtered to the new selection — real cross-filtering, not CSS dimming alone
  }

  clearSelection(): void {
    this.selection.clear();
    this.loadStatusCounts();
  }
}

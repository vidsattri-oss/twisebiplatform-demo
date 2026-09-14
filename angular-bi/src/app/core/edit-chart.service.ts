import { Injectable, signal } from '@angular/core';
import { ChartType, QueryConfig } from './models';

export interface PendingChartEdit {
  mode: 'edit';
  dashboardId: number;
  chartId: number;
  title: string;
  chartType: ChartType;
  config: QueryConfig;
}

export interface PendingChartAdd {
  mode: 'add';
  dashboardId: number;
  dashboardName: string;
}

export type PendingChartRequest = PendingChartEdit | PendingChartAdd;

/**
 * One-shot handoff from Dashboard to Query Builder — the dashboard always
 * initiates: "Edit query" hands over an existing chart's config, "+ Add
 * visual" just names the target dashboard. Query Builder consumes it once
 * on load. Kept out of the router (query params) because a full QueryConfig
 * isn't worth serializing into a URL.
 */
@Injectable({ providedIn: 'root' })
export class EditChartService {
  private readonly pending = signal<PendingChartRequest | null>(null);

  requestEdit(edit: Omit<PendingChartEdit, 'mode'>): void {
    this.pending.set({ mode: 'edit', ...edit });
  }

  requestAdd(add: Omit<PendingChartAdd, 'mode'>): void {
    this.pending.set({ mode: 'add', ...add });
  }

  consume(): PendingChartRequest | null {
    const v = this.pending();
    this.pending.set(null);
    return v;
  }
}

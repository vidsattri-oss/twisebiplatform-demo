import { Injectable, signal } from '@angular/core';
import { ChartType, QueryConfig } from './models';

export interface PendingChartEdit {
  dashboardId: number;
  chartId: number;
  title: string;
  chartType: ChartType;
  config: QueryConfig;
}

/**
 * One-shot handoff from Dashboard's "Edit query" action to Query Builder:
 * Dashboard requests an edit and navigates; Query Builder consumes it once
 * on load. Kept out of the router (query params) because the payload is a
 * full QueryConfig, not something worth serializing into a URL.
 */
@Injectable({ providedIn: 'root' })
export class EditChartService {
  private readonly pending = signal<PendingChartEdit | null>(null);

  request(edit: PendingChartEdit): void {
    this.pending.set(edit);
  }

  consume(): PendingChartEdit | null {
    const v = this.pending();
    this.pending.set(null);
    return v;
  }
}

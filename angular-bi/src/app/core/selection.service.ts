import { Injectable, signal } from '@angular/core';

export interface Selection {
  connectionId: number;
  table: string;
  groupBy: string;
  value: string;
}

/**
 * The shared "selection bus" behind cross-filtering (item 06). A selection
 * is scoped to a connection+table+groupBy, not just a bare value — with
 * multiple connections and dashboards now in play, "Crew A" and a
 * same-named row in an unrelated table must never be confused for the
 * same selection. Any chart querying that same connection+table+groupBy
 * picks it up as an extra filter; everything else is unaffected.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {
  readonly current = signal<Selection | null>(null);

  select(sel: Selection): void {
    const cur = this.current();
    const same = cur && cur.connectionId === sel.connectionId && cur.table === sel.table && cur.groupBy === sel.groupBy && cur.value === sel.value;
    this.current.set(same ? null : sel);
  }

  isActive(connectionId: number, table: string, groupBy: string, value: string): boolean {
    const cur = this.current();
    return !!cur && cur.connectionId === connectionId && cur.table === table && cur.groupBy === groupBy && cur.value === value;
  }

  /**
   * Does the current selection apply to (i.e. should add a filter to)
   * queries against this connection+table? Deliberately independent of
   * the asking chart's OWN groupBy — "Task Status" (grouped by status)
   * still gets filtered by a crew clicked in "Productivity by Crew"
   * (grouped by crew_id), because both query the same table. Any query
   * against the same table can take an extra `groupBy = value` filter
   * regardless of what it's grouping by itself.
   */
  appliesTo(connectionId: number, table: string): boolean {
    const cur = this.current();
    return !!cur && cur.connectionId === connectionId && cur.table === table;
  }

  clear(): void {
    this.current.set(null);
  }
}

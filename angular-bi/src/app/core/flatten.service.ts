import { Injectable } from '@angular/core';
import { FlatRow } from './models';

/**
 * Recursive JSON flattener — item 02 in the feasibility tracker ("High
 * feasibility... fully achievable client-side"). Objects flatten to dotted
 * paths, arrays to bracketed indices, matching how the tracker's own
 * example (task_daily.daily_data, employee_ids[], equipment_ids[]) reads.
 *
 * This runs on the main thread, which the tracker flags as fine only up to
 * ~1-10MB; a real deployment would move this into a Web Worker past that,
 * per the documented scalability note — not necessary for demo-sized
 * payloads like the ones seeded here.
 */
@Injectable({ providedIn: 'root' })
export class FlattenService {
  flatten(value: unknown, prefix = ''): FlatRow {
    const out: FlatRow = {};
    this.walk(value, prefix, out);
    return out;
  }

  /** Flattens a list of objects, returning the union of all keys seen (for a table view). */
  flattenAll(values: unknown[]): { columns: string[]; rows: FlatRow[] } {
    const rows = values.map((v) => this.flatten(v));
    const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return { columns, rows };
  }

  private walk(value: unknown, path: string, out: FlatRow): void {
    if (value === null || value === undefined) {
      out[path || '(root)'] = null;
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out[path || '(root)'] = '[]';
        return;
      }
      value.forEach((item, i) => this.walk(item, `${path}[${i}]`, out));
      return;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        out[path || '(root)'] = '{}';
        return;
      }
      for (const [k, v] of entries) {
        this.walk(v, path ? `${path}.${k}` : k, out);
      }
      return;
    }
    // scalar leaf
    out[path || '(root)'] = value as string | number | boolean;
  }
}

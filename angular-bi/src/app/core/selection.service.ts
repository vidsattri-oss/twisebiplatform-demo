import { Injectable, signal } from '@angular/core';

/**
 * The shared "selection bus" behind cross-filtering (item 06 in the
 * feasibility tracker): any chart can publish a selection, and any chart
 * (including the one that published it) reads the current selection to
 * decide what to highlight or dim. One signal, many subscribers — no chart
 * needs to know about any other chart directly.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {
  /** The currently selected group key (e.g. a crew name), or null for none. */
  readonly selected = signal<string | null>(null);
  /** Multi-select set, for Ctrl/Cmd+click. */
  readonly multiSelected = signal<Set<string>>(new Set());

  select(key: string, additive = false): void {
    if (additive) {
      const next = new Set(this.multiSelected());
      if (next.has(key)) next.delete(key);
      else next.add(key);
      this.multiSelected.set(next);
      this.selected.set(null);
      return;
    }
    this.multiSelected.set(new Set());
    this.selected.set(this.selected() === key ? null : key);
  }

  isActive(key: string): boolean {
    return this.selected() === key || this.multiSelected().has(key);
  }

  hasAnySelection(): boolean {
    return this.selected() !== null || this.multiSelected().size > 0;
  }

  clear(): void {
    this.selected.set(null);
    this.multiSelected.set(new Set());
  }
}

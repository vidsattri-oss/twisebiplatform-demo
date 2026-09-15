import { Injectable, signal } from '@angular/core';

/**
 * Stand-in for TWise's global filter bar state (Country / Sector / BU / Plant /
 * From–To). In TWise this already exists; the harness only needs the same
 * signals so the bridge below can be copied over unchanged.
 */
@Injectable({ providedIn: 'root' })
export class GlobalFiltersService {
  readonly country = 'Oman';
  readonly sector = 'Construction and real estate';
  readonly businessUnit = 'Energy';
  /** Demo list; TWise loads these from /api/common/plant-filters. */
  readonly plants = ['Marmul ODC', 'Nimr ODC'];

  readonly plant = signal<string | null>(null);
  readonly from = signal<string | null>(null);
  readonly to = signal<string | null>(null);

  clear(): void {
    this.plant.set(null);
    this.from.set(null);
    this.to.set(null);
  }
}

import { InjectionToken } from '@angular/core';
import { BiFilter, SemanticModel } from './contract';

/**
 * How a host's own global filters (TWise's Country / Plant / date bar) reach
 * reports. The library calls filtersFor() inside a computed signal, so any
 * signals the host reads there keep reports in sync automatically.
 * Return only filters whose target exists in the given model.
 */
export interface BiFilterBridge {
  filtersFor(model: SemanticModel): BiFilter[];
  /** Short label shown next to host filters in the filter pane, e.g. "TWise filter bar". */
  readonly label?: string;
}

export const BI_FILTER_BRIDGE = new InjectionToken<BiFilterBridge>('BI_FILTER_BRIDGE');

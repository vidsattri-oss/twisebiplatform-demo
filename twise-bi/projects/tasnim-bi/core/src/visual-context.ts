import { InjectionToken, Signal } from '@angular/core';
import { BiFilter, QueryResult, Scalar, SemanticModel, VisualDefinition } from './contract';
import { BiDataSource } from './data-source';
import { Selection, VisualContext } from './filter-context';
import { formatValue } from './format';
import { BiVisualType } from './visual-registry';

/**
 * What every visual — built-in or host-registered — receives. Inject it with
 * inject(BI_VISUAL_CONTEXT). Data for "aggregate" visuals is already queried
 * (and cancelled when superseded); "rows" and "slicer" visuals use dataSource
 * with filterContext().filters.
 */
export interface BiVisualContext {
  readonly definition: Signal<VisualDefinition>;
  readonly visualType: Signal<BiVisualType | undefined>;
  readonly model: Signal<SemanticModel | null>;
  readonly filterContext: Signal<VisualContext | null>;
  readonly result: Signal<QueryResult | undefined>;
  readonly loading: Signal<boolean>;
  readonly selection: Signal<Selection | null>;
  readonly slicerFilter: Signal<BiFilter | null>;
  readonly editMode: Signal<boolean>;
  readonly dataSource: BiDataSource;
  readonly format: typeof formatValue;
  /** Click selects; additive (Ctrl/Cmd) adds or removes the point. */
  select(keys: Scalar[], additive: boolean): void;
  /** Opens See records for a data point, or for the whole visual when keys is null. */
  seeRecords(keys: Scalar[] | null): void;
  /**
   * Power BI's data point context menu (Include, Exclude, See records) at the
   * pointer position. Visuals call this from their contextmenu handler.
   */
  openDataPointMenu(keys: Scalar[], event: MouseEvent): void;
  /** Slicers publish their filter here; null clears it. */
  setSlicerFilter(filter: BiFilter | null): void;
}

export const BI_VISUAL_CONTEXT = new InjectionToken<BiVisualContext>('BI_VISUAL_CONTEXT');

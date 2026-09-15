import {
  BiFilter,
  DateLevel,
  GroupField,
  PageDefinition,
  ReportDefinition,
  Scalar,
  VisualDefinition,
  VisualInteraction,
  fieldRef,
  isMeasureItem,
  sameField,
} from './contract';

/**
 * The one place a visual's filter context is built (spec invariants I3, I4).
 * Pure, so every rule below is unit-tested without Angular.
 */

/** Data points selected in one visual (Ctrl/Cmd-click adds values). */
export interface Selection {
  visualId: string;
  field: GroupField;
  values: Scalar[];
}

export type FilterOrigin =
  | { scope: 'host' }
  | { scope: 'report' }
  | { scope: 'page' }
  | { scope: 'visual' }
  | { scope: 'slicer'; visualId: string }
  | { scope: 'selection'; visualId: string };

export interface VisualContext {
  filters: BiFilter[];
  /** Parallel to filters: where each one came from, for "filters on this visual". */
  origins: FilterOrigin[];
  /** Present when a selection highlights this visual instead of filtering it. */
  highlight?: BiFilter[];
}

export interface ContextInput {
  report: ReportDefinition;
  page: PageDefinition;
  visual: VisualDefinition;
  hostFilters: readonly BiFilter[];
  slicerFilters: Readonly<Record<string, BiFilter | null | undefined>>;
  selection: Selection | null;
  interactionFor: (source: VisualDefinition, target: VisualDefinition) => VisualInteraction;
}

export function categoryFields(visual: VisualDefinition): GroupField[] {
  return (visual.roles['category'] ?? []).filter((item): item is GroupField => !isMeasureItem(item));
}

export function measureNames(visual: VisualDefinition, role = 'values'): string[] {
  return (visual.roles[role] ?? []).filter(isMeasureItem).map((m) => m.measure);
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** The inclusive date range a date-level key ("2026", "2026-Q1", "2026-02") stands for. */
export function dateLevelRange(level: DateLevel, key: string): [string, string] {
  const year = Number(key.slice(0, 4));
  if (level === 'year') return [iso(year, 1, 1), iso(year, 12, 31)];
  if (level === 'quarter') {
    const q = Number(key.slice(-1));
    return [iso(year, (q - 1) * 3 + 1, 1), iso(year, q * 3 + 1, 0)];
  }
  const month = Number(key.slice(5, 7));
  return [iso(year, month, 1), iso(year, month + 1, 0)];
}

/** Filters that pin one data point: a category value, or the date range a date-level key covers. */
export function pointFilters(fields: GroupField[], keys: Scalar[]): BiFilter[] {
  return fields.map((field, i) => {
    const key = keys[i] ?? null;
    if (field.dateLevel && typeof key === 'string') {
      const [min, max] = dateLevelRange(field.dateLevel, key);
      return { kind: 'range', target: fieldRef(field), min, max };
    }
    return { kind: 'basic', target: fieldRef(field), operator: 'in', values: [key] };
  });
}

export function selectionFilters(selection: Selection): BiFilter[] {
  if (selection.field.dateLevel) return pointFilters([selection.field], [selection.values[0] ?? null]);
  return [{ kind: 'basic', target: fieldRef(selection.field), operator: 'in', values: [...selection.values] }];
}

export function buildVisualContext(input: ContextInput): VisualContext {
  const { report, page, visual, selection } = input;
  const filters: BiFilter[] = [];
  const origins: FilterOrigin[] = [];
  const add = (list: readonly BiFilter[], origin: FilterOrigin) => {
    for (const f of list) {
      filters.push(f);
      origins.push(origin);
    }
  };

  add(input.hostFilters, { scope: 'host' });
  add(report.filters, { scope: 'report' });
  add(page.filters, { scope: 'page' });
  add(visual.filters ?? [], { scope: 'visual' });

  // Slicers filter everything on the page except themselves (a slicer never narrows its own list).
  for (const other of page.visuals) {
    const slicer = other.id === visual.id ? null : input.slicerFilters[other.id];
    if (slicer) add([slicer], { scope: 'slicer', visualId: other.id });
  }

  let highlight: BiFilter[] | undefined;
  const source = selection ? page.visuals.find((v) => v.id === selection.visualId) : undefined;
  if (selection && source) {
    const selected = selectionFilters(selection);
    if (source.id === visual.id) {
      highlight = selected; // I4: the source visual keeps every data point.
    } else {
      const mode = input.interactionFor(source, visual);
      if (mode === 'filter') add(selected, { scope: 'selection', visualId: source.id });
      else if (mode === 'highlight') highlight = selected;
    }
  }

  return { filters, origins, highlight };
}

/**
 * See records uses the visual's own filters plus the data point — never the
 * highlight, because Power BI shows the rows behind the whole bar (I3).
 */
export function seeRecordsFilters(context: VisualContext, fields: GroupField[], keys: Scalar[]): BiFilter[] {
  return [...context.filters, ...pointFilters(fields, keys)];
}

/**
 * Click: select only this point (clicking the sole selected point clears).
 * Ctrl/Cmd-click: add or remove the point. Date levels stay single-select
 * because one range filter can only describe one period.
 */
export function toggleSelection(
  current: Selection | null,
  visualId: string,
  field: GroupField,
  value: Scalar,
  additive: boolean,
): Selection | null {
  const sameSource = !!current && current.visualId === visualId && sameField(current.field, field);
  if (!sameSource) return { visualId, field, values: [value] };

  const has = current.values.includes(value);
  if (!additive || field.dateLevel) {
    return has && current.values.length === 1 ? null : { visualId, field, values: [value] };
  }
  const values = has ? current.values.filter((v) => v !== value) : [...current.values, value];
  return values.length ? { ...current, values } : null;
}

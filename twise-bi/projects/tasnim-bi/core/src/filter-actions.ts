import { BiFilter, GroupField, PageDefinition, RelativeDateFilter, ReportDefinition, Scalar, fieldRef } from './contract';
import { dateLevelRange, pointFilters } from './filter-context';

/**
 * Pure helpers behind the filter features that change report state: Include /
 * Exclude, slicer defaults, "Reset to default" and relative date presets.
 */

/**
 * Power BI "Include" keeps only this data point; "Exclude" removes it. Both land
 * as visual-level filters. Excluding a date-level period (a year, quarter or
 * month) keeps everything before or after it, and blanks stay excluded, as a
 * NOT BETWEEN would.
 */
export function includeExcludeFilters(fields: GroupField[], keys: Scalar[], mode: 'include' | 'exclude'): BiFilter[] {
  if (mode === 'include') return pointFilters(fields, keys);
  return fields.map((field, i): BiFilter => {
    const key = keys[i] ?? null;
    if (field.dateLevel && typeof key === 'string') {
      const [min, max] = dateLevelRange(field.dateLevel, key);
      return { kind: 'advanced', target: fieldRef(field), logic: 'or', conditions: [{ operator: 'lt', value: min }, { operator: 'gt', value: max }] };
    }
    return { kind: 'basic', target: fieldRef(field), operator: 'notIn', values: [key] };
  });
}

/** Saved default selection of every slicer in the report, by visual id. */
export function slicerDefaults(report: ReportDefinition): Record<string, BiFilter | null> {
  const defaults: Record<string, BiFilter | null> = {};
  for (const page of report.pages) {
    for (const v of page.visuals) {
      const d = v.options?.['defaultFilter'] as BiFilter | null | undefined;
      if (v.type === 'slicer' && d) defaults[v.id] = d;
    }
  }
  return defaults;
}

const filtersOf = (page: PageDefinition | undefined, visualId: string) => page?.visuals.find((v) => v.id === visualId)?.filters;

/**
 * The current definition with every report, page and visual filter put back to
 * its saved value. Layout, titles and other unsaved edits are kept; pages and
 * visuals that did not exist when saved keep their filters.
 */
export function restoreSavedFilters(current: ReportDefinition, saved: ReportDefinition): ReportDefinition {
  return {
    ...current,
    filters: saved.filters,
    pages: current.pages.map((page) => {
      const savedPage = saved.pages.find((p) => p.id === page.id);
      if (!savedPage) return page;
      return {
        ...page,
        filters: savedPage.filters,
        visuals: page.visuals.map((v) => {
          const savedFilters = filtersOf(savedPage, v.id);
          return savedFilters ? { ...v, filters: savedFilters } : v;
        }),
      };
    }),
  };
}

export interface RelativeDatePreset {
  label: string;
  value: Pick<RelativeDateFilter, 'period' | 'count' | 'unit' | 'includeToday'>;
}

/** The one-click choices Power BI offers above the relative date controls. */
export const RELATIVE_DATE_PRESETS: RelativeDatePreset[] = [
  { label: 'Today', value: { period: 'this', count: 1, unit: 'day', includeToday: true } },
  { label: 'Yesterday', value: { period: 'last', count: 1, unit: 'day', includeToday: false } },
  { label: 'Last 7 days', value: { period: 'last', count: 7, unit: 'day', includeToday: true } },
  { label: 'Last 30 days', value: { period: 'last', count: 30, unit: 'day', includeToday: true } },
  { label: 'Last 90 days', value: { period: 'last', count: 90, unit: 'day', includeToday: true } },
  { label: 'This month', value: { period: 'this', count: 1, unit: 'month', includeToday: true } },
];

/** Label of the preset a filter matches, if any. */
export function presetLabel(f: Pick<RelativeDateFilter, 'period' | 'count' | 'unit' | 'includeToday'>): string | null {
  const today = f.includeToday !== false;
  const match = RELATIVE_DATE_PRESETS.find(
    (p) => p.value.period === f.period && p.value.unit === f.unit && (f.period === 'this' || (p.value.count === f.count && p.value.includeToday === today)),
  );
  return match?.label ?? null;
}

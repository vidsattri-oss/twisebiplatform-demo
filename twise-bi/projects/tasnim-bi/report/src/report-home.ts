import { RecentReport, ReportCategory, ReportSummary } from '@tasnim/bi/core';

/** Pure rules behind the Reports home (R1): tabs, search, category filter, sort and category sections. */

export type HomeTab = 'all' | 'favorites' | 'recent';
export type HomeSort = 'name-asc' | 'name-desc' | 'updated' | 'opened';
export type HomeView = 'grid' | 'list' | 'compact';

export const UNCATEGORISED = 'Uncategorised';
export const UNCATEGORISED_COLOR = '#59585D';

export interface HomeQuery {
  tab: HomeTab;
  search: string;
  /** null shows every category. */
  category: string | null;
  sort: HomeSort;
}

export interface HomeSection {
  name: string;
  description: string | null;
  color: string;
  reports: ReportSummary[];
}

export function tabCounts(reports: readonly ReportSummary[], favorites: readonly number[], recent: readonly RecentReport[]) {
  const ids = new Set(reports.map((r) => r.id));
  return {
    all: reports.length,
    favorites: favorites.filter((id) => ids.has(id)).length,
    recent: new Set(recent.map((r) => r.reportId).filter((id) => ids.has(id))).size,
  };
}

export function visibleReports(
  reports: readonly ReportSummary[],
  favorites: readonly number[],
  recent: readonly RecentReport[],
  query: HomeQuery,
): ReportSummary[] {
  const opened = new Map(recent.map((r) => [r.reportId, r.openedAt]));
  const search = query.search.trim().toLowerCase();
  const matches = reports.filter((r) => {
    if (query.tab === 'favorites' && !favorites.includes(r.id)) return false;
    if (query.tab === 'recent' && !opened.has(r.id)) return false;
    if (query.category !== null && (r.category ?? UNCATEGORISED) !== query.category) return false;
    if (!search) return true;
    return [r.name, r.description ?? '', r.category ?? ''].some((text) => text.toLowerCase().includes(search));
  });
  const byName = (a: ReportSummary, b: ReportSummary) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sorters: Record<HomeSort, (a: ReportSummary, b: ReportSummary) => number> = {
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    updated: (a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || byName(a, b),
    // Reports never opened go last, alphabetically.
    opened: (a, b) => (opened.get(b.id) ?? '').localeCompare(opened.get(a.id) ?? '') || byName(a, b),
  };
  return [...matches].sort(sorters[query.sort]);
}

/** Sections in category order; empty categories are left out and uncategorised reports come last. */
export function groupSections(reports: readonly ReportSummary[], categories: readonly ReportCategory[]): HomeSection[] {
  const known = new Set(categories.map((c) => c.name));
  const sections: HomeSection[] = categories
    .map((c) => ({ name: c.name, description: c.description ?? null, color: c.color, reports: reports.filter((r) => r.category === c.name) }))
    .filter((s) => s.reports.length);
  const loose = reports.filter((r) => !r.category || !known.has(r.category));
  if (loose.length) sections.push({ name: UNCATEGORISED, description: 'Reports without a category yet.', color: UNCATEGORISED_COLOR, reports: loose });
  return sections;
}

/** "5m ago", "3h ago", "2d ago", or the date for anything older than four weeks. */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 28 * 24 * 60) return `${Math.round(minutes / 1440)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export type GlyphShape = 'bars' | 'line' | 'pie' | 'donut' | 'table' | 'card' | 'custom';

/** The preview glyph: up to three shapes for the kinds of visual a report uses. */
export function glyphShapes(visualTypes: readonly string[] | undefined): GlyphShape[] {
  const map: Record<string, GlyphShape> = { column: 'bars', bar: 'bars', line: 'line', pie: 'pie', donut: 'donut', table: 'table', card: 'card' };
  const shapes = [...new Set((visualTypes ?? []).filter((t) => t !== 'slicer').map((t) => map[t] ?? 'custom'))].slice(0, 3);
  return shapes.length ? shapes : ['bars', 'pie', 'table'];
}

export interface HomeState {
  tab: HomeTab;
  sort: HomeSort;
  view: HomeView;
  collapsed: string[];
}

export const HOME_STATE_KEY = 'tasnim-bi.reports-home';
export const DEFAULT_HOME_STATE: HomeState = { tab: 'all', sort: 'name-asc', view: 'grid', collapsed: [] };

export function parseHomeState(raw: string | null): HomeState {
  try {
    const s = JSON.parse(raw ?? 'null') as Partial<HomeState> | null;
    return {
      tab: s?.tab === 'favorites' || s?.tab === 'recent' ? s.tab : 'all',
      sort: s?.sort === 'name-desc' || s?.sort === 'updated' || s?.sort === 'opened' ? s.sort : 'name-asc',
      view: s?.view === 'list' || s?.view === 'compact' ? s.view : 'grid',
      collapsed: Array.isArray(s?.collapsed) ? s.collapsed.filter((c): c is string => typeof c === 'string').slice(0, 50) : [],
    };
  } catch {
    return DEFAULT_HOME_STATE;
  }
}

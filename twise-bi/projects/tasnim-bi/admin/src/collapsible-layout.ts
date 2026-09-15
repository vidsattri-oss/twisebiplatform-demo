/** Which parts of the Data sources page are open (D1). Remembered per browser. */
export type DataSourceSection = 'tables' | 'datasetFilters' | 'relationships' | 'measures';

export interface DataSourcesLayout {
  connectionsCollapsed: boolean;
  open: Record<DataSourceSection, boolean>;
}

export const DATA_SOURCES_LAYOUT_KEY = 'tasnim-bi.data-sources.layout';

/** Tables start open; the longer reference sections start closed so the page fits on one screen. */
export const DEFAULT_DATA_SOURCES_LAYOUT: DataSourcesLayout = {
  connectionsCollapsed: false,
  open: { tables: true, datasetFilters: false, relationships: false, measures: false },
};

/** A stored layout merged over the defaults; anything unreadable falls back to the defaults. */
export function parseDataSourcesLayout(raw: string | null): DataSourcesLayout {
  if (!raw) return DEFAULT_DATA_SOURCES_LAYOUT;
  try {
    const stored = JSON.parse(raw) as Partial<DataSourcesLayout> | null;
    const open = { ...DEFAULT_DATA_SOURCES_LAYOUT.open };
    for (const key of Object.keys(open) as DataSourceSection[]) {
      if (typeof stored?.open?.[key] === 'boolean') open[key] = stored.open[key];
    }
    return { connectionsCollapsed: stored?.connectionsCollapsed === true, open };
  } catch {
    return DEFAULT_DATA_SOURCES_LAYOUT;
  }
}

export function readDataSourcesLayout(): DataSourcesLayout {
  try {
    return parseDataSourcesLayout(localStorage.getItem(DATA_SOURCES_LAYOUT_KEY));
  } catch {
    return DEFAULT_DATA_SOURCES_LAYOUT;
  }
}

export function writeDataSourcesLayout(layout: DataSourcesLayout): void {
  try {
    localStorage.setItem(DATA_SOURCES_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private windows and blocked storage: the layout simply isn't remembered.
  }
}

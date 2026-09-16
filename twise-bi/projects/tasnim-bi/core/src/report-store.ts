import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import {
  BiFilter,
  DataType,
  FilterScope,
  PageDefinition,
  Report,
  ReportDefinition,
  ReportInput,
  RoleItem,
  RowsRequest,
  Scalar,
  SemanticModel,
  VisualDefinition,
  VisualInteraction,
  isMeasureItem,
} from './contract';
import { BI_DATA_SOURCE, describeError } from './data-source';
import { columnOf } from './describe-filter';
import { includeExcludeFilters, restoreSavedFilters, slicerDefaults } from './filter-actions';
import {
  Selection,
  VisualContext,
  buildVisualContext,
  categoryFields,
  measureNames,
  seeRecordsFilters,
  selectionFields,
  toggleSelection,
} from './filter-context';
import { formatKey } from './format';
import { BI_FILTER_BRIDGE } from './host-bridge';
import { VisualRegistry } from './visual-registry';

export interface GridColumn {
  name: string;
  dataType: DataType;
  format?: string;
}

export interface SeeRecordsState {
  title: string;
  request: RowsRequest;
  columns: GridColumn[];
}

export interface DataPointMenuState {
  visualId: string;
  keys: Scalar[];
  x: number;
  y: number;
}

const toInput = (r: Report): ReportInput => ({ name: r.name, modelId: r.modelId, definition: r.definition });
const activeSlicers = (filters: Record<string, BiFilter | null>) =>
  JSON.stringify(Object.entries(filters).filter(([, f]) => f).sort(([a], [b]) => a.localeCompare(b)));

function uniqueId(base: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * All state for one open report. Provided by <bi-report>, never in root, so two
 * reports (or a report kept alive by TWise's route reuse) never share a
 * selection. Every update is immutable so OnPush/zoneless views stay correct.
 */
@Injectable()
export class ReportStore {
  private readonly ds = inject(BI_DATA_SOURCE);
  private readonly registry = inject(VisualRegistry);
  private readonly bridge = inject(BI_FILTER_BRIDGE, { optional: true });
  private readonly loads = new Subject<number>();

  readonly report = signal<Report | null>(null);
  readonly model = signal<SemanticModel | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  private readonly savedSnapshot = signal('');

  readonly pageId = signal<string | null>(null);
  readonly selection = signal<Selection | null>(null);
  readonly slicerFilters = signal<Record<string, BiFilter | null>>({});
  readonly editMode = signal(false);
  /** The visual the Visualizations pane and "filters on this visual" section act on. */
  readonly focusedVisualId = signal<string | null>(null);
  /** Power BI focus mode: one visual fills the canvas. */
  readonly focusModeVisualId = signal<string | null>(null);
  readonly seeRecords = signal<SeeRecordsState | null>(null);
  /** One data point context menu at a time, across all visuals. */
  readonly dataPointMenu = signal<DataPointMenuState | null>(null);

  readonly dirty = computed(() => {
    const r = this.report();
    return !!r && JSON.stringify(toInput(r)) !== this.savedSnapshot();
  });
  readonly datasetFilters = computed<BiFilter[]>(() => this.model()?.datasetFilters ?? []);
  readonly multiSelectWithoutCtrl = computed(() => this.report()?.definition.settings?.multiSelectWithoutCtrl === true);
  /** True when "Reset to default" would change something: a selection, a slicer off its default, or a filter off its saved value. */
  readonly canReset = computed(() => {
    const r = this.report();
    if (!r) return false;
    if (this.selection()) return true;
    if (activeSlicers(this.slicerFilters()) !== activeSlicers(slicerDefaults(r.definition))) return true;
    const saved = (JSON.parse(this.savedSnapshot() || 'null') as ReportInput | null)?.definition;
    return !!saved && JSON.stringify(restoreSavedFilters(r.definition, saved)) !== JSON.stringify(r.definition);
  });
  readonly page = computed<PageDefinition | null>(() => {
    const pages = this.report()?.definition.pages ?? [];
    return pages.find((p) => p.id === this.pageId()) ?? pages[0] ?? null;
  });
  readonly focusedVisual = computed(() => this.page()?.visuals.find((v) => v.id === this.focusedVisualId()) ?? null);
  readonly hostFilters = computed<BiFilter[]>(() => {
    const model = this.model();
    return model && this.bridge ? this.bridge.filtersFor(model) : [];
  });
  readonly hostLabel = this.bridge?.label ?? 'Host filters';

  constructor() {
    this.loads
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((id) =>
          this.ds.getReport(id).pipe(
            switchMap((report) => this.ds.getModel(report.modelId).pipe(map((model) => ({ report, model })))),
            catchError((err: unknown) => {
              this.error.set(describeError(err, "This report couldn't be loaded."));
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((loaded) => {
        this.loading.set(false);
        if (!loaded) return;
        this.model.set(loaded.model);
        this.adopt(loaded.report, true);
      });
  }

  load(reportId: number): void {
    this.loads.next(reportId);
  }

  /** Refetches the model after a measure, column or property changes, keeping the report's unsaved edits (E1). */
  reloadModel(): void {
    const report = this.report();
    if (!report) return;
    this.ds.getModel(report.modelId).subscribe({
      next: (model) => this.model.set(model),
      error: (err: unknown) => this.saveError.set(describeError(err, "The model couldn't be reloaded.")),
    });
  }

  /**
   * Adds a field or measure from the Data pane to the focused visual's first role
   * with room for it (E1). Returns null when added, or a message saying why not.
   */
  addFieldToFocused(item: RoleItem): string | null {
    const visual = this.focusedVisual();
    if (!visual) return 'Select a visual on the canvas first, then click a field.';
    const type = this.registry.get(visual.type);
    if (!type) return `“${visual.type}” isn't a registered visual.`;
    const wantsMeasure = isMeasureItem(item);
    const same = (a: RoleItem, b: RoleItem) => JSON.stringify(a) === JSON.stringify(b);
    if (Object.values(visual.roles).some((items) => items.some((existing) => same(existing, item)))) {
      return `It's already on ${visual.title || type.label}.`;
    }
    const role = type.roles.find((r) => (r.kind === 'measure') === wantsMeasure && (visual.roles[r.name]?.length ?? 0) < r.max);
    if (!role) {
      return `${visual.title || type.label} has no free ${wantsMeasure ? 'value' : 'field'} slot. Remove one in Visualizations, or pick ${wantsMeasure ? 'a column' : 'a measure'}.`;
    }
    this.updateVisual(visual.id, (v) => ({ ...v, roles: { ...v.roles, [role.name]: [...(v.roles[role.name] ?? []), item] } }));
    return null;
  }

  private adopt(report: Report, resetView: boolean): void {
    this.report.set(report);
    this.savedSnapshot.set(JSON.stringify(toInput(report)));
    if (resetView) {
      this.pageId.set(report.definition.pages[0]?.id ?? null);
      this.selection.set(null);
      this.slicerFilters.set(slicerDefaults(report.definition));
      this.focusedVisualId.set(null);
      this.focusModeVisualId.set(null);
      this.dataPointMenu.set(null);
    }
  }

  // --- Reading ------------------------------------------------------------------

  interactionFor(source: VisualDefinition, target: VisualDefinition): VisualInteraction {
    return source.interactions?.[target.id] ?? this.registry.interactionFor(target.type);
  }

  /** Reactive when called inside computed(): tracks report, page, host filters, slicers and selection. */
  contextFor(visual: VisualDefinition): VisualContext | null {
    const report = this.report();
    const page = this.page();
    if (!report || !page) return null;
    return buildVisualContext({
      report: report.definition,
      page,
      visual,
      hostFilters: this.hostFilters(),
      slicerFilters: this.slicerFilters(),
      selection: this.selection(),
      interactionFor: (s, t) => this.interactionFor(s, t),
    });
  }

  // --- Interacting ----------------------------------------------------------------

  /** Click selects one point; Ctrl/Cmd (or the report's multi-select setting) adds or removes it. */
  select(visual: VisualDefinition, keys: Scalar[], additive: boolean): void {
    const field = selectionFields(visual)[0];
    if (!field) return;
    const add = additive || this.multiSelectWithoutCtrl();
    this.selection.update((current) => toggleSelection(current, visual.id, field, keys[0] ?? null, add));
  }

  clearSelection(): void {
    this.selection.set(null);
  }

  setSlicerFilter(visualId: string, filter: BiFilter | null): void {
    this.slicerFilters.update((s) => ({ ...s, [visualId]: filter }));
  }

  /**
   * Power BI "Reset to default": every report, page and visual filter back to its
   * saved value, every slicer back to its default selection, and no selection.
   */
  resetToDefault(): void {
    const report = this.report();
    if (!report) return;
    const saved = JSON.parse(this.savedSnapshot()) as ReportInput;
    this.updateDefinition((d) => restoreSavedFilters(d, saved.definition));
    this.slicerFilters.set(slicerDefaults(report.definition));
    this.selection.set(null);
    this.dataPointMenu.set(null);
  }

  openDataPointMenu(visualId: string, keys: Scalar[], x: number, y: number): void {
    this.dataPointMenu.set({ visualId, keys, x, y });
  }

  closeDataPointMenu(): void {
    if (this.dataPointMenu()) this.dataPointMenu.set(null);
  }

  /** Include keeps only this data point in the visual; Exclude removes it. Both add visual-level filters. */
  includeExclude(visual: VisualDefinition, keys: Scalar[], mode: 'include' | 'exclude'): void {
    const fields = selectionFields(visual);
    if (!fields.length) return;
    const added = includeExcludeFilters(fields, keys, mode).map((f) => ({ ...f, scope: 'visual' as const }));
    this.updateVisual(visual.id, (v) => ({ ...v, filters: [...(v.filters ?? []), ...added] }));
    if (this.selection()?.visualId === visual.id) this.selection.set(null);
    this.dataPointMenu.set(null);
  }

  goToPage(pageId: string): void {
    this.pageId.set(pageId);
    this.selection.set(null);
    this.focusedVisualId.set(null);
    this.focusModeVisualId.set(null);
  }

  toggleFocusMode(visualId: string): void {
    this.focusModeVisualId.update((current) => (current === visualId ? null : visualId));
  }

  /** Opens See records for a data point (keys) or for the whole visual (null), using the visual's own context (I3). */
  openSeeRecords(visual: VisualDefinition, keys: Scalar[] | null): void {
    const model = this.model();
    const context = this.contextFor(visual);
    if (!model || !context) return;
    const fields = categoryFields(visual);
    const measure = model.measures.find((m) => m.name === measureNames(visual)[0]);
    const firstColumn = (visual.roles['columns'] ?? [])[0] as { table?: string } | undefined;
    const tableName = measure?.table ?? fields[0]?.table ?? firstColumn?.table;
    const table = model.tables.find((t) => t.name === tableName);
    if (!table) return;

    const pointLabel = keys
      ? keys.map((k, i) => {
          const field = fields[i];
          const col = field ? columnOf(model, field) : undefined;
          return formatKey(k, field?.dateLevel ? 'text' : col?.dataType, col?.format);
        }).join(', ')
      : null;
    this.seeRecords.set({
      title: `${visual.title || 'Visual'}${pointLabel ? ` — ${pointLabel}` : ''}`,
      request: { modelId: model.id, table: table.name, filters: keys ? seeRecordsFilters(context, fields, keys) : context.filters },
      columns: table.columns.filter((c) => !c.hidden).map((c) => ({ name: c.name, dataType: c.dataType, format: c.format })),
    });
  }

  closeSeeRecords(): void {
    this.seeRecords.set(null);
  }

  // --- Editing --------------------------------------------------------------------

  private updateDefinition(fn: (d: ReportDefinition) => ReportDefinition): void {
    this.report.update((r) => (r ? { ...r, definition: fn(r.definition) } : r));
  }

  private updatePage(pageId: string, fn: (p: PageDefinition) => PageDefinition): void {
    this.updateDefinition((d) => ({ ...d, pages: d.pages.map((p) => (p.id === pageId ? fn(p) : p)) }));
  }

  private updateCurrentPage(fn: (p: PageDefinition) => PageDefinition): void {
    const page = this.page();
    if (page) this.updatePage(page.id, fn);
  }

  updateVisual(visualId: string, change: Partial<VisualDefinition> | ((v: VisualDefinition) => VisualDefinition)): void {
    this.updateCurrentPage((p) => ({
      ...p,
      visuals: p.visuals.map((v) => (v.id !== visualId ? v : typeof change === 'function' ? change(v) : { ...v, ...change })),
    }));
  }

  addVisual(type: string): string | null {
    const visualType = this.registry.get(type);
    const page = this.page();
    if (!visualType || !page) return null;
    const taken = new Set(this.report()?.definition.pages.flatMap((p) => p.visuals.map((v) => v.id)) ?? []);
    const id = uniqueId(type, taken);
    const bottom = page.visuals.reduce((max, v) => Math.max(max, (v.layout?.y ?? 0) + (v.layout?.h ?? 6)), 0);
    const visual: VisualDefinition = {
      id,
      type,
      title: visualType.label,
      roles: Object.fromEntries(visualType.roles.map((r) => [r.name, []])),
      filters: [],
      layout: { x: 0, y: bottom, w: type === 'slicer' || type === 'card' ? 3 : 6, h: type === 'slicer' ? 3 : type === 'card' ? 2 : 6 },
    };
    this.updateCurrentPage((p) => ({ ...p, visuals: [...p.visuals, visual] }));
    this.focusedVisualId.set(id);
    return id;
  }

  changeVisualType(visualId: string, type: string): void {
    const visualType = this.registry.get(type);
    if (!visualType) return;
    this.updateVisual(visualId, (v) => ({
      ...v,
      type,
      // Keep fields whose role still exists; new roles start empty.
      roles: Object.fromEntries(visualType.roles.map((r) => [r.name, (v.roles[r.name] ?? []).slice(0, r.max)])),
    }));
  }

  removeVisual(visualId: string): void {
    this.updateCurrentPage((p) => ({
      ...p,
      visuals: p.visuals
        .filter((v) => v.id !== visualId)
        .map((v) => {
          if (!v.interactions?.[visualId]) return v;
          const { [visualId]: _removed, ...rest } = v.interactions;
          return { ...v, interactions: rest };
        }),
    }));
    if (this.selection()?.visualId === visualId) this.selection.set(null);
    if (this.focusedVisualId() === visualId) this.focusedVisualId.set(null);
    if (this.focusModeVisualId() === visualId) this.focusModeVisualId.set(null);
    this.slicerFilters.update(({ [visualId]: _removed, ...rest }) => rest);
  }

  /** Saves the slicer's current selection (or none) as the selection it opens with. */
  setSlicerDefault(visualId: string): void {
    const current = this.slicerFilters()[visualId] ?? null;
    this.updateVisual(visualId, (v) => {
      const { defaultFilter: _old, ...options } = v.options ?? {};
      return { ...v, options: current ? { ...options, defaultFilter: current } : options };
    });
  }

  setMultiSelectWithoutCtrl(on: boolean): void {
    this.updateDefinition((d) => ({ ...d, settings: { ...(d.settings ?? {}), multiSelectWithoutCtrl: on } }));
  }

  setInteraction(sourceId: string, targetId: string, mode: VisualInteraction): void {
    this.updateVisual(sourceId, (v) => ({ ...v, interactions: { ...(v.interactions ?? {}), [targetId]: mode } }));
  }

  private updateFilters(scope: FilterScope, visualId: string | null, fn: (filters: BiFilter[]) => BiFilter[]): void {
    if (scope === 'report') this.updateDefinition((d) => ({ ...d, filters: fn(d.filters) }));
    else if (scope === 'page') this.updateCurrentPage((p) => ({ ...p, filters: fn(p.filters) }));
    else if (visualId) this.updateVisual(visualId, (v) => ({ ...v, filters: fn(v.filters ?? []) }));
  }

  addFilter(scope: FilterScope, filter: BiFilter, visualId: string | null = null): void {
    this.updateFilters(scope, visualId, (fs) => [...fs, filter]);
  }

  replaceFilter(scope: FilterScope, index: number, filter: BiFilter, visualId: string | null = null): void {
    this.updateFilters(scope, visualId, (fs) => fs.map((f, i) => (i === index ? filter : f)));
  }

  removeFilter(scope: FilterScope, index: number, visualId: string | null = null): void {
    this.updateFilters(scope, visualId, (fs) => fs.filter((_, i) => i !== index));
  }

  renameReport(name: string): void {
    this.report.update((r) => (r ? { ...r, name } : r));
  }

  addPage(): void {
    const pages = this.report()?.definition.pages ?? [];
    const id = uniqueId('page', new Set(pages.map((p) => p.id)));
    this.updateDefinition((d) => ({ ...d, pages: [...d.pages, { id, name: `Page ${d.pages.length + 1}`, filters: [], visuals: [] }] }));
    this.goToPage(id);
  }

  renamePage(pageId: string, name: string): void {
    this.updatePage(pageId, (p) => ({ ...p, name }));
  }

  removePage(pageId: string): void {
    const pages = this.report()?.definition.pages ?? [];
    if (pages.length <= 1) return;
    this.updateDefinition((d) => ({ ...d, pages: d.pages.filter((p) => p.id !== pageId) }));
    if (this.page()?.id !== this.pageId()) this.goToPage(this.report()?.definition.pages[0]?.id ?? '');
  }

  save(): void {
    const report = this.report();
    if (!report || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.ds.updateReport(report.id, toInput(report)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        // Keep edits made while the save was in flight; only move the saved baseline.
        this.savedSnapshot.set(JSON.stringify(toInput(saved)));
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(describeError(err, "The report couldn't be saved."));
      },
    });
  }

  discardChanges(): void {
    const report = this.report();
    if (!report) return;
    const saved = JSON.parse(this.savedSnapshot()) as ReportInput;
    this.report.set({ ...report, ...saved });
    if (!saved.definition.pages.some((p) => p.id === this.pageId())) this.pageId.set(saved.definition.pages[0]?.id ?? null);
    this.focusedVisualId.set(null);
  }
}

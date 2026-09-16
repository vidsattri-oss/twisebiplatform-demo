import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, of } from 'rxjs';
import { BI_REPORT_PREFERENCES, GRID_GAP, GRID_ROW_HEIGHT, PluginVisuals, RoleItem, VisualDefinition, clampLayout, isMeasureItem, magneticLayout } from '@tasnim/bi/core';
import { DataPaneComponent } from '@tasnim/bi/modeling';
import { FilterPaneComponent } from './filter-pane.component';
import { ReportStore } from '@tasnim/bi/core';
import { SeeRecordsSheetComponent } from './see-records-sheet.component';
import { VisualHostComponent } from './visual-host.component';
import { VisualizationsPaneComponent } from './visualizations-pane.component';

const toId = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
};

/**
 * A Power BI-style report: pages of visuals on a 12-column canvas, cross-
 * highlighting, slicers, a filter pane, See records, focus mode and in-place
 * editing. Use it routed (BI_ROUTES, ":reportId") or embedded:
 * <bi-report [reportId]="42" [canEdit]="false" />.
 */
@Component({
  selector: 'bi-report',
  imports: [RouterLink, VisualHostComponent, FilterPaneComponent, SeeRecordsSheetComponent, VisualizationsPaneComponent, DataPaneComponent],
  providers: [ReportStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'store.closeDataPointMenu()',
    '(document:keydown.escape)': 'store.closeDataPointMenu()',
    '(window:scroll)': 'store.closeDataPointMenu()',
    '(window:pointermove)': 'moveVisual($event)',
    '(window:pointerup)': 'endVisualMove()',
    '(window:pointercancel)': 'endVisualMove()',
  },
  templateUrl: './report.component.html',
  styleUrls: ['../../styles/tokens.css', '../../styles/controls.css', './report.component.css'],
})
export class ReportComponent {
  protected readonly store = inject(ReportStore);
  private readonly route = inject(ActivatedRoute, { optional: true });

  readonly reportId = input<number | undefined, unknown>(undefined, { transform: toId });
  /**
   * Hosts without edit permission for the current user pass false. Anything else
   * means editable: router input binding sets unmatched inputs to undefined.
   */
  readonly canEdit = input<boolean, boolean | null | undefined>(true, { transform: (value) => value !== false });
  /** Open straight into edit mode, e.g. the ?edit=1 the Reports home adds for Edit and New report. */
  readonly edit = input<boolean, unknown>(false, { transform: (value) => value === true || value === '' || value === '1' || value === 'true' });
  private readonly preferences = inject(BI_REPORT_PREFERENCES);
  private editAppliedFor: number | null = null;

  /** Only a report opened through BI_ROUTES links back to the report list; an embedded report has no BI parent route. */
  protected readonly base = this.route?.routeConfig?.path === ':reportId' ? (this.route.parent ?? null) : null;
  private readonly routeId = toSignal(this.route ? this.route.paramMap.pipe(map((p) => toId(p.get('reportId')))) : of(undefined), { initialValue: undefined });
  protected readonly effectiveId = computed(() => this.reportId() ?? this.routeId());

  protected readonly filterPaneOpen = signal(false);
  /** E1: the left side of the editor shows Visualizations or the Data pane. */
  protected readonly leftTab = signal<'visualizations' | 'data'>('visualizations');
  protected readonly fieldNote = signal<string | null>(null);
  protected readonly renamingPage = signal(false);

  protected readonly visuals = computed(() => this.store.page()?.visuals ?? []);
  protected readonly focusVisual = computed(() => this.visuals().find((v) => v.id === this.store.focusModeVisualId()) ?? null);
  protected readonly activeSlicers = computed(() => Object.values(this.store.slicerFilters()).filter(Boolean).length);
  protected readonly filterCount = computed(() => {
    const report = this.store.report();
    const page = this.store.page();
    return this.store.hostFilters().length + (report?.definition.filters.length ?? 0) + (page?.filters.length ?? 0) + this.activeSlicers();
  });
  protected readonly canvasRows = computed(() => this.visuals().reduce((max, v) => Math.max(max, (v.layout?.y ?? 0) + (v.layout?.h ?? 6)), 1));
  private readonly visualGrid = viewChild<ElementRef<HTMLElement>>('visualGrid');
  private readonly moveState = signal<{ id: string; layout: ReturnType<typeof clampLayout>; offsetX: number; offsetY: number; colStep: number; rowStep: number } | null>(null);
  protected readonly movingVisualId = computed(() => this.moveState()?.id ?? null);

  constructor() {
    // Installed plug-in visuals join the registry, so saved reports that use them render (V2).
    void inject(PluginVisuals).ensureLoaded();
    effect(() => {
      const id = this.effectiveId();
      if (id === undefined) return;
      untracked(() => {
        this.store.load(id);
        // R3: recent reports. A preferences service that is down must never stop the report opening.
        this.preferences.recordOpened(id).subscribe({ error: () => undefined });
      });
    });
    // Enter edit mode once per opened report when asked; "Done editing" is not undone afterwards.
    effect(() => {
      const report = this.store.report();
      if (!report || !this.edit() || !this.canEdit() || this.editAppliedFor === report.id) return;
      this.editAppliedFor = report.id;
      untracked(() => this.store.editMode.set(true));
    });
  }

  protected layout(v: VisualDefinition) {
    const l = v.layout ?? { x: 0, y: 0, w: 6, h: 6 };
    const c = clampLayout(l);
    return { col: c.x + 1, row: c.y + 1, w: c.w, h: c.h };
  }

  protected startVisualMove(id: string, event: PointerEvent): void {
    if (!this.store.editMode() || event.button !== 0) return;
    const grid = this.visualGrid()?.nativeElement;
    const visual = this.visuals().find((item) => item.id === id);
    if (!grid || !visual) return;
    const cell = [...grid.children].find((item) => (item as HTMLElement).dataset['visualId'] === id) as HTMLElement | undefined;
    if (!cell) return;
    const gridRect = grid.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    this.moveState.set({
      id,
      layout: clampLayout(visual.layout),
      offsetX: event.clientX - cellRect.left,
      offsetY: event.clientY - cellRect.top,
      colStep: (gridRect.width + GRID_GAP) / 12,
      rowStep: GRID_ROW_HEIGHT + GRID_GAP,
    });
    event.preventDefault();
  }

  protected moveVisual(event: PointerEvent): void {
    const state = this.moveState();
    const grid = this.visualGrid()?.nativeElement;
    if (!state || !grid || event.buttons === 0) return;
    const rect = grid.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left - state.offsetX) / state.colStep);
    const y = Math.round((event.clientY - rect.top - state.offsetY) / state.rowStep);
    const next = clampLayout({ ...state.layout, x, y });
    const current = this.visuals().find((item) => item.id === state.id);
    if (!current || current.layout?.x === next.x && current.layout?.y === next.y) return;
    this.store.updateVisual(state.id, { layout: next });
  }

  protected endVisualMove(): void {
    const state = this.moveState();
    if (!state) return;
    const current = this.visuals().find((item) => item.id === state.id);
    if (current) {
      const occupied = this.visuals().filter((item) => item.id !== state.id).map((item) => item.layout).filter((layout): layout is NonNullable<typeof layout> => !!layout);
      this.store.updateVisual(state.id, { layout: magneticLayout(current.layout, occupied) });
    }
    this.moveState.set(null);
  }

  protected addField(item: RoleItem): void {
    const problem = this.store.addFieldToFocused(item);
    const label = isMeasureItem(item) ? `[${item.measure}]` : item.column;
    const target = this.store.focusedVisual();
    this.fieldNote.set(problem ?? `Added ${label} to ${target?.title || target?.type}.`);
  }

  protected retry(): void {
    const id = this.effectiveId();
    if (id !== undefined) this.store.load(id);
  }

  protected toggleEdit(): void {
    const editing = !this.store.editMode();
    this.store.editMode.set(editing);
    if (!editing) this.store.focusedVisualId.set(null);
  }

  protected renamePage(pageId: string, event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name) this.store.renamePage(pageId, name);
    this.renamingPage.set(false);
  }

  protected renameReport(event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name) this.store.renameReport(name);
  }
}

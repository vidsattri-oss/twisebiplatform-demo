import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, of } from 'rxjs';
import { VisualDefinition, clampLayout } from '@tasnim/bi/core';
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
  imports: [RouterLink, VisualHostComponent, FilterPaneComponent, SeeRecordsSheetComponent, VisualizationsPaneComponent],
  providers: [ReportStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  /** Only a report opened through BI_ROUTES links back to the report list; an embedded report has no BI parent route. */
  protected readonly base = this.route?.routeConfig?.path === ':reportId' ? (this.route.parent ?? null) : null;
  private readonly routeId = toSignal(this.route ? this.route.paramMap.pipe(map((p) => toId(p.get('reportId')))) : of(undefined), { initialValue: undefined });
  protected readonly effectiveId = computed(() => this.reportId() ?? this.routeId());

  protected readonly filterPaneOpen = signal(false);
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

  constructor() {
    effect(() => {
      const id = this.effectiveId();
      if (id !== undefined) untracked(() => this.store.load(id));
    });
  }

  protected layout(v: VisualDefinition) {
    const l = v.layout ?? { x: 0, y: 0, w: 6, h: 6 };
    const c = clampLayout(l);
    return { col: c.x + 1, row: c.y + 1, w: c.w, h: c.h };
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

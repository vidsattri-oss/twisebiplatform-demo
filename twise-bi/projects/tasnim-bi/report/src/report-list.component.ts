import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import {
  BI_DATA_SOURCE,
  BI_REPORT_PREFERENCES,
  ReportCategory,
  ReportPatch,
  ReportPreferencesState,
  ReportSummary,
  VisualRegistry,
  describeError,
  withFavorite,
} from '@tasnim/bi/core';
import { BiNavComponent } from './bi-nav.component';
import {
  DEFAULT_HOME_STATE,
  GlyphShape,
  HOME_STATE_KEY,
  HomeSort,
  HomeTab,
  HomeView,
  UNCATEGORISED,
  UNCATEGORISED_COLOR,
  glyphShapes,
  groupSections,
  parseHomeState,
  relativeTime,
  tabCounts,
  visibleReports,
} from './report-home';

function readHomeState() {
  try {
    return parseHomeState(localStorage.getItem(HOME_STATE_KEY));
  } catch {
    return DEFAULT_HOME_STATE;
  }
}

/**
 * The Reports home (R1), following TWise's Standard Charts page: All / Favorites
 * / Recent, search, category filter, sort, grid / list / compact views and
 * collapsible category sections, with favorite, publish, rename, move,
 * duplicate and delete on each report.
 */
@Component({
  selector: 'bi-report-list',
  imports: [RouterLink, NgTemplateOutlet, BiNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'openMenu.set(null)',
    '(document:keydown.escape)': 'openMenu.set(null)',
  },
  templateUrl: './report-list.component.html',
  styleUrls: ['../../styles/tokens.css', '../../styles/controls.css', '../../styles/page.css', './report-list.component.css'],
})
export class ReportListComponent {
  private readonly ds = inject(BI_DATA_SOURCE);
  private readonly router = inject(Router);
  private readonly preferences = inject(BI_REPORT_PREFERENCES);
  private readonly registry = inject(VisualRegistry);
  protected readonly base = inject(ActivatedRoute, { optional: true })?.parent ?? null;

  protected readonly data = rxResource({
    stream: () =>
      forkJoin({
        reports: this.ds.listReports(),
        models: this.ds.listModels(),
        // A backend without categories still lists reports, all uncategorised.
        categories: this.ds.listCategories().pipe(catchError(() => of<ReportCategory[]>([]))),
      }),
  });
  protected readonly loadError = computed(() => (this.data.error() ? describeError(this.data.error(), "Reports couldn't be loaded.") : null));
  protected readonly reports = computed(() => this.data.value()?.reports ?? []);
  protected readonly categories = computed(() => this.data.value()?.categories ?? []);
  protected readonly modelNames = computed(() => new Map((this.data.value()?.models ?? []).map((m) => [m.id, m.name])));

  protected readonly prefs = signal<ReportPreferencesState>({ favorites: [], recent: [] });
  protected readonly prefsNote = signal<string | null>(null);

  private readonly saved = readHomeState();
  protected readonly tab = signal<HomeTab>(this.saved.tab);
  protected readonly sort = signal<HomeSort>(this.saved.sort);
  protected readonly view = signal<HomeView>(this.saved.view);
  protected readonly collapsed = signal<string[]>(this.saved.collapsed);
  protected readonly search = signal('');
  protected readonly category = signal<string | null>(null);

  protected readonly counts = computed(() => tabCounts(this.reports(), this.prefs().favorites, this.prefs().recent));
  protected readonly visible = computed(() =>
    visibleReports(this.reports(), this.prefs().favorites, this.prefs().recent, { tab: this.tab(), search: this.search(), category: this.category(), sort: this.sort() }),
  );
  protected readonly sections = computed(() => groupSections(this.visible(), this.categories()));
  protected readonly categoryOptions = computed(() => {
    const names = this.categories().map((c) => c.name);
    return this.reports().some((r) => !r.category || !names.includes(r.category)) ? [...names, UNCATEGORISED] : names;
  });
  protected readonly filtered = computed(() => this.search().trim() !== '' || this.category() !== null);

  protected readonly openMenu = signal<number | null>(null);
  protected readonly renamingId = signal<number | null>(null);
  protected readonly movingId = signal<number | null>(null);
  protected readonly confirmDeleteId = signal<number | null>(null);
  protected readonly message = signal<{ kind: 'error' | 'success'; text: string } | null>(null);

  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly newModelId = signal<number | null>(null);
  protected readonly newCategory = signal<string | null>(null);
  protected readonly newDescription = signal('');

  protected readonly tabs: { id: HomeTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'favorites', label: 'Favorites' },
    { id: 'recent', label: 'Recent' },
  ];
  protected readonly sorts: { id: HomeSort; label: string }[] = [
    { id: 'name-asc', label: 'Name A–Z' },
    { id: 'name-desc', label: 'Name Z–A' },
    { id: 'updated', label: 'Recently updated' },
    { id: 'opened', label: 'Recently opened' },
  ];

  constructor() {
    this.preferences.load().subscribe({
      next: (state) => this.prefs.set(state),
      error: (err: unknown) => this.prefsNote.set(`Favorites and recent reports are unavailable right now. ${describeError(err, '')}`.trim()),
    });
    effect(() => {
      const state = { tab: this.tab(), sort: this.sort(), view: this.view(), collapsed: this.collapsed() };
      try {
        localStorage.setItem(HOME_STATE_KEY, JSON.stringify(state));
      } catch {
        // Per-browser convenience only.
      }
    });
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected chooseTab(tab: HomeTab): void {
    this.tab.set(tab);
    if (tab === 'recent') this.sort.set('opened');
  }

  protected colorOf(r: ReportSummary): string {
    return this.categories().find((c) => c.name === r.category)?.color ?? UNCATEGORISED_COLOR;
  }

  protected iconOf(r: ReportSummary): string {
    const first = (r.visualTypes ?? []).find((t) => t !== 'slicer');
    return (first && this.registry.get(first)?.icon) || 'M6 20V11M12 20V5M18 20v-6M3 20h18';
  }

  protected shapes(r: ReportSummary): GlyphShape[] {
    return glyphShapes(r.visualTypes);
  }

  protected when(r: ReportSummary): string {
    return relativeTime(r.updatedAt);
  }

  protected isFavorite(r: ReportSummary): boolean {
    return this.prefs().favorites.includes(r.id);
  }

  protected isCollapsed(section: string): boolean {
    return this.collapsed().includes(section);
  }

  protected toggleSection(section: string): void {
    this.collapsed.update((list) => (list.includes(section) ? list.filter((s) => s !== section) : [...list, section]));
  }

  protected scrollRow(row: HTMLElement, direction: 1 | -1): void {
    row.scrollBy({ left: direction * Math.max(240, row.clientWidth * 0.8), behavior: 'smooth' });
  }

  protected toggleMenu(id: number, event: Event): void {
    event.stopPropagation();
    this.openMenu.update((current) => (current === id ? null : id));
    this.movingId.set(null);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.category.set(null);
  }

  protected toggleFavorite(r: ReportSummary, event: Event): void {
    event.stopPropagation();
    const favorite = !this.isFavorite(r);
    const before = this.prefs();
    this.prefs.set(withFavorite(before, r.id, favorite));
    this.preferences.setFavorite(r.id, favorite).subscribe({
      next: (state) => this.prefs.set(state),
      error: (err: unknown) => {
        this.prefs.set(before);
        this.message.set({ kind: 'error', text: describeError(err, "The favorite couldn't be saved.") });
      },
    });
  }

  protected open(r: ReportSummary, edit = false): void {
    this.openMenu.set(null);
    if (this.base) this.router.navigate([r.id], { relativeTo: this.base, queryParams: edit ? { edit: 1 } : {} });
  }

  protected duplicate(r: ReportSummary): void {
    this.openMenu.set(null);
    this.ds.duplicateReport(r.id).subscribe({
      next: (copy) => {
        this.message.set({ kind: 'success', text: `Created “${copy.name}” as a draft.` });
        this.data.reload();
      },
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The report couldn't be duplicated.") }),
    });
  }

  protected startRename(r: ReportSummary): void {
    this.openMenu.set(null);
    this.renamingId.set(r.id);
  }

  protected rename(r: ReportSummary, name: string): void {
    this.renamingId.set(null);
    if (!name.trim() || name.trim() === r.name) return;
    this.patch(r, { name: name.trim() }, 'renamed');
  }

  protected moveTo(r: ReportSummary, category: string): void {
    this.openMenu.set(null);
    this.movingId.set(null);
    this.patch(r, { category: category === UNCATEGORISED || category === '' ? null : category }, `moved to ${category || UNCATEGORISED}`);
  }

  protected togglePublished(r: ReportSummary): void {
    this.openMenu.set(null);
    const status = r.status === 'published' ? 'draft' : 'published';
    this.patch(r, { status }, status === 'published' ? 'published' : 'set back to draft');
  }

  private patch(r: ReportSummary, patch: ReportPatch, done: string): void {
    this.ds.patchReport(r.id, patch).subscribe({
      next: (saved) => {
        this.message.set({ kind: 'success', text: `“${saved.name}” ${done}.` });
        this.data.reload();
      },
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The report couldn't be updated.") }),
    });
  }

  protected askDelete(r: ReportSummary): void {
    this.openMenu.set(null);
    this.confirmDeleteId.set(r.id);
  }

  protected remove(r: ReportSummary): void {
    this.confirmDeleteId.set(null);
    this.ds.deleteReport(r.id).subscribe({
      next: () => {
        if (this.isFavorite(r)) this.preferences.setFavorite(r.id, false).subscribe({ next: (s) => this.prefs.set(s), error: () => undefined });
        this.message.set({ kind: 'success', text: `Deleted “${r.name}”.` });
        this.data.reload();
      },
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The report couldn't be deleted.") }),
    });
  }

  protected startCreate(): void {
    this.creating.set(true);
    this.newName.set('');
    this.newDescription.set('');
    this.newCategory.set(this.category() !== UNCATEGORISED ? this.category() : null);
    this.newModelId.set(this.data.value()?.models.find((m) => m.status === 'connected')?.id ?? null);
  }

  protected create(): void {
    const name = this.newName().trim();
    const modelId = this.newModelId();
    this.message.set(null);
    if (!name || modelId === null) {
      this.message.set({ kind: 'error', text: 'Give the report a name and choose a data source.' });
      return;
    }
    this.ds
      .createReport({
        name,
        modelId,
        category: this.newCategory(),
        description: this.newDescription().trim() || null,
        status: 'draft',
        definition: { filters: [], pages: [{ id: 'page-1', name: 'Page 1', filters: [], visuals: [] }] },
      })
      .subscribe({
        next: (report) => {
          this.creating.set(false);
          if (this.base) this.router.navigate([report.id], { relativeTo: this.base, queryParams: { edit: 1 } });
          else this.data.reload();
        },
        error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The report couldn't be created.") }),
      });
  }
}

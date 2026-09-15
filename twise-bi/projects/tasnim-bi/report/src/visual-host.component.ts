import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, computed, inject, input, resource, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Scalar, VisualDefinition, VisualQuery } from '@tasnim/bi/core';
import { BI_DATA_SOURCE, describeError } from '@tasnim/bi/core';
import { describeFilter } from '@tasnim/bi/core';
import { categoryFields, measureNames } from '@tasnim/bi/core';
import { formatValue } from '@tasnim/bi/core';
import { VisualRegistry } from '@tasnim/bi/core';
import { BI_VISUAL_CONTEXT, BiVisualContext } from '@tasnim/bi/core';
import { ReportStore } from '@tasnim/bi/core';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SCOPE_LABELS: Record<string, string> = {
  host: 'Filter bar',
  report: 'All pages',
  page: 'This page',
  visual: 'This visual',
  slicer: 'Slicer',
  selection: 'Selection',
};

/**
 * Frames one visual: header actions, loading / empty / error states, and the
 * data query for aggregate visuals. The query runs through rxResource, so a new
 * filter context cancels the superseded request before its response can render (I7).
 */
@Component({
  selector: 'bi-visual',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visual-host.component.html',
  styleUrl: './visual-host.component.css',
})
export class VisualHostComponent {
  protected readonly store = inject(ReportStore);
  private readonly registry = inject(VisualRegistry);
  private readonly ds = inject(BI_DATA_SOURCE);

  readonly visual = input.required<VisualDefinition>();

  readonly showFilters = signal(false);
  readonly confirmRemove = signal(false);

  readonly type = computed(() => this.registry.get(this.visual().type));
  readonly title = computed(() => this.visual().title ?? '');
  readonly subtitle = computed(() => (typeof this.visual().options?.['subtitle'] === 'string' ? (this.visual().options?.['subtitle'] as string) : ''));
  readonly context = computed(() => this.store.contextFor(this.visual()), { equal: sameJson });

  readonly missingFields = computed(() => {
    const type = this.type();
    if (!type) return null;
    const missing = type.roles.find((role) => (this.visual().roles[role.name]?.length ?? 0) < role.min);
    return missing ? `Add a field to ${missing.label} to show data.` : null;
  });

  readonly query = computed<VisualQuery | undefined>(() => {
    const type = this.type();
    const model = this.store.model();
    const context = this.context();
    const visual = this.visual();
    if (type?.dataKind !== 'aggregate' || !model || !context || this.missingFields()) return undefined;
    return {
      modelId: model.id,
      groupBy: categoryFields(visual),
      measures: measureNames(visual),
      filters: context.filters,
      highlight: type.defaultInteraction === 'highlight' || context.highlight ? context.highlight : undefined,
    };
  }, { equal: sameJson });

  readonly data = rxResource({ params: () => this.query(), stream: ({ params }) => this.ds.query(params) });

  readonly componentType = resource({
    params: () => this.type(),
    loader: ({ params }) => params.loadComponent(),
  });

  readonly errorText = computed(() => {
    const err = this.data.error() ?? this.componentType.error();
    return err ? describeError(err, "This visual couldn't load.") : null;
  });

  readonly filterItems = computed(() => {
    const context = this.context();
    const model = this.store.model();
    const ignored = new Set(this.data.value()?.ignoredFilters ?? []);
    return [
      ...this.store.datasetFilters().map((filter) => ({ scope: 'Dataset', text: describeFilter(filter, model), ignored: false })),
      ...(context?.filters ?? []).map((filter, i) => ({
        scope: SCOPE_LABELS[context?.origins[i]?.scope ?? 'visual'] ?? '',
        text: describeFilter(filter, model),
        ignored: ignored.has(i),
      })),
    ];
  });
  readonly highlightText = computed(() => (this.context()?.highlight ?? []).map((f) => describeFilter(f, this.store.model())).join('; '));
  readonly activeFilterCount = computed(() => this.filterItems().length + (this.context()?.highlight ? 1 : 0));

  readonly isAggregate = computed(() => this.type()?.dataKind === 'aggregate');
  readonly showSkeleton = computed(() => this.isAggregate() && this.data.isLoading() && !this.data.hasValue());
  readonly isEmpty = computed(() => this.isAggregate() && this.data.hasValue() && !this.data.value()?.rows.length);
  readonly selectedHere = computed(() => this.store.selection()?.visualId === this.visual().id);
  readonly menu = computed(() => {
    const m = this.store.dataPointMenu();
    return m?.visualId === this.visual().id ? m : null;
  });

  include(mode: 'include' | 'exclude', keys: Scalar[]): void {
    this.store.includeExclude(this.visual(), keys, mode);
  }

  seeRecordsFromMenu(keys: Scalar[]): void {
    this.store.closeDataPointMenu();
    this.seeRecords(keys);
  }

  private readonly visualContext: BiVisualContext = {
    definition: this.visual,
    visualType: this.type,
    model: this.store.model,
    filterContext: this.context,
    result: computed(() => (this.data.hasValue() ? this.data.value() : undefined)),
    loading: this.data.isLoading,
    selection: this.store.selection,
    slicerFilter: computed(() => this.store.slicerFilters()[this.visual().id] ?? null),
    editMode: this.store.editMode,
    dataSource: this.ds,
    format: formatValue,
    select: (keys, additive) => this.store.select(this.visual(), keys, additive),
    seeRecords: (keys) => this.seeRecords(keys),
    openDataPointMenu: (keys, event) => {
      event.preventDefault();
      event.stopPropagation();
      // Keep the menu inside the window; it is position: fixed at the pointer.
      const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 200));
      const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 140));
      this.store.openDataPointMenu(this.visual().id, keys, x, y);
    },
    setSlicerFilter: (filter) => this.store.setSlicerFilter(this.visual().id, filter),
  };

  readonly childInjector = Injector.create({
    providers: [{ provide: BI_VISUAL_CONTEXT, useValue: this.visualContext }],
    parent: inject(Injector),
  });

  seeRecords(keys: Scalar[] | null): void {
    const selection = this.store.selection();
    const fromSelection = selection?.visualId === this.visual().id && selection.values.length === 1 ? [selection.values[0]] : null;
    this.store.openSeeRecords(this.visual(), keys ?? fromSelection);
  }

  toggleFilters(event: Event): void {
    event.stopPropagation();
    this.showFilters.update((v) => !v);
  }

  edit(event: Event): void {
    event.stopPropagation();
    this.store.focusedVisualId.set(this.visual().id);
  }

  remove(): void {
    this.confirmRemove.set(false);
    this.store.removeVisual(this.visual().id);
  }

  onFrameClick(): void {
    if (this.store.editMode()) this.store.focusedVisualId.set(this.visual().id);
  }
}

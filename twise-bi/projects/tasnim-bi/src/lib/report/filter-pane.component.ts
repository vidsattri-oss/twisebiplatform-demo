import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { BiFilter, FilterScope } from '../core/contract';
import { describeFilter } from '../core/describe-filter';
import { FilterEditorComponent } from './filter-editor.component';
import { ReportStore } from './report-store';

interface EditingState {
  scope: FilterScope;
  index: number | null;
}

/**
 * Power BI's Filters pane: filters on this visual, this page and all pages,
 * plus the host's filter bar (read-only). Viewers can change filter values;
 * adding and removing filters needs edit mode.
 */
@Component({
  selector: 'bi-filter-pane',
  imports: [FilterEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filter-pane.component.html',
  styleUrls: ['../styles/controls.css', './filter-pane.component.css'],
})
export class FilterPaneComponent {
  protected readonly store = inject(ReportStore);
  readonly closed = output<void>();

  protected readonly editing = signal<EditingState | null>(null);

  protected readonly sections = computed(() => {
    const report = this.store.report();
    const page = this.store.page();
    const visual = this.store.focusedVisual();
    const list: { scope: FilterScope; title: string; filters: BiFilter[] }[] = [];
    if (visual) list.push({ scope: 'visual', title: `Filters on this visual · ${visual.title || visual.type}`, filters: visual.filters ?? [] });
    if (page) list.push({ scope: 'page', title: 'Filters on this page', filters: page.filters });
    if (report) list.push({ scope: 'report', title: 'Filters on all pages', filters: report.definition.filters });
    return list;
  });

  protected describe(filter: BiFilter): string {
    return describeFilter(filter, this.store.model());
  }

  protected isEditing(scope: FilterScope, index: number | null): boolean {
    const e = this.editing();
    return !!e && e.scope === scope && e.index === index;
  }

  protected apply(scope: FilterScope, index: number | null, filter: BiFilter): void {
    const visualId = scope === 'visual' ? this.store.focusedVisualId() : null;
    const scoped = { ...filter, scope };
    if (index === null) this.store.addFilter(scope, scoped, visualId);
    else this.store.replaceFilter(scope, index, scoped, visualId);
    this.editing.set(null);
  }

  protected remove(scope: FilterScope, index: number): void {
    this.store.removeFilter(scope, index, scope === 'visual' ? this.store.focusedVisualId() : null);
    this.editing.set(null);
  }
}

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { BiFilter, GroupField, RelativeDateFilter, Scalar, ValuesRequest, fieldRef, isMeasureItem } from '@tasnim/bi/core';
import { describeError } from '@tasnim/bi/core';
import { columnOf } from '@tasnim/bi/core';
import { BI_VISUAL_CONTEXT } from '@tasnim/bi/core';

type SlicerMode = 'dropdown' | 'list' | 'between' | 'relativeDate';
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let nextId = 0;

/**
 * Power BI slicer: dropdown or list (multi-select with search), between (dates
 * and numbers) and relative date. Its values are narrowed by every other filter
 * on the page but never by its own selection.
 */
@Component({
  selector: 'bi-slicer-visual',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'closeOnOutsideClick($event)',
    '(keydown.escape)': 'open.set(false)',
  },
  templateUrl: './slicer-visual.component.html',
  styleUrl: './slicer-visual.component.css',
})
export class SlicerVisualComponent {
  private readonly ctx = inject(BI_VISUAL_CONTEXT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly uid = `bi-slicer-${nextId++}`;

  readonly open = signal(false);
  readonly search = signal('');
  private readonly debouncedSearch = toSignal(toObservable(this.search).pipe(debounceTime(250)), { initialValue: '' });

  readonly field = computed(() => (this.ctx.definition().roles['field'] ?? []).find((i): i is GroupField => !isMeasureItem(i)) ?? null, { equal: sameJson });
  readonly column = computed(() => {
    const field = this.field();
    return field ? columnOf(this.ctx.model(), field) : undefined;
  });
  readonly mode = computed<SlicerMode>(() => {
    const configured = this.ctx.definition().options?.['mode'];
    if (configured === 'dropdown' || configured === 'list' || configured === 'between' || configured === 'relativeDate') return configured;
    const type = this.column()?.dataType;
    return type === 'date' || type === 'number' || type === 'integer' ? 'between' : 'dropdown';
  });
  readonly inputType = computed(() => (this.column()?.dataType === 'date' ? 'date' : 'number'));

  private readonly request = computed<ValuesRequest | undefined>(() => {
    const model = this.ctx.model();
    const context = this.ctx.filterContext();
    const field = this.field();
    if (!model || !context || !field) return undefined;
    const ranged = this.mode() === 'between' || this.mode() === 'relativeDate';
    return { modelId: model.id, target: fieldRef(field), filters: context.filters, search: ranged ? undefined : this.debouncedSearch() || undefined, limit: ranged ? 1 : 200 };
  }, { equal: sameJson });

  readonly values = rxResource({ params: () => this.request(), stream: ({ params }) => this.ctx.dataSource.values(params) });
  readonly valuesError = computed(() => (this.values.error() ? describeError(this.values.error(), "Values couldn't be loaded.") : null));

  readonly filter = this.ctx.slicerFilter;
  readonly selected = computed(() => {
    const f = this.filter();
    return new Set<Scalar>(f?.kind === 'basic' ? f.values : []);
  });
  readonly options = computed(() => this.values.value()?.values ?? []);

  readonly summary = computed(() => {
    const values = [...this.selected()];
    if (!values.length) return 'All';
    return values.length === 1 ? this.label(values[0]) : `${values.length} selected`;
  });

  readonly range = computed(() => {
    const f = this.filter();
    return f?.kind === 'range' ? { min: f.min ?? null, max: f.max ?? null } : { min: null, max: null };
  });

  readonly relative = computed<RelativeDateFilter | null>(() => {
    const f = this.filter();
    return f?.kind === 'relativeDate' ? f : null;
  });

  label(value: Scalar): string {
    return this.ctx.format(value, this.column()?.format, this.column()?.dataType);
  }

  isSelected(value: Scalar): boolean {
    return this.selected().has(value);
  }

  toggle(value: Scalar): void {
    const field = this.field();
    if (!field) return;
    const next = new Set(this.selected());
    if (next.has(value)) next.delete(value);
    else next.add(value);
    this.publish(next.size ? { kind: 'basic', target: fieldRef(field), operator: 'in', values: [...next] } : null);
  }

  selectAll(): void {
    this.publish(null);
  }

  setRange(edge: 'min' | 'max', raw: string): void {
    const field = this.field();
    if (!field) return;
    const value: Scalar = raw === '' ? null : this.inputType() === 'number' ? Number(raw) : raw;
    const next = { ...this.range(), [edge]: value };
    this.publish(next.min === null && next.max === null ? null : { kind: 'range', target: fieldRef(field), ...next });
  }

  setRelative(change: Partial<Pick<RelativeDateFilter, 'period' | 'count' | 'unit'>>): void {
    const field = this.field();
    if (!field) return;
    const current = this.relative() ?? { kind: 'relativeDate' as const, target: fieldRef(field), period: 'last' as const, count: 1, unit: 'month' as const };
    const count = Math.max(1, Math.min(1000, Math.round(Number(change.count ?? current.count)) || 1));
    this.publish({ ...current, ...change, count });
  }

  clear(): void {
    this.publish(null);
  }

  private publish(filter: BiFilter | null): void {
    this.ctx.setSlicerFilter(filter);
  }

  closeOnOutsideClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

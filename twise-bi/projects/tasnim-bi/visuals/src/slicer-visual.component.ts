import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import {
  BiFilter,
  GroupField,
  RELATIVE_DATE_PRESETS,
  RelativeDateFilter,
  RelativeTimeFilter,
  Scalar,
  ValuesRequest,
  fieldRef,
  isMeasureItem,
  presetLabel,
  toDateTimeInput,
} from '@tasnim/bi/core';
import { describeError } from '@tasnim/bi/core';
import { columnOf } from '@tasnim/bi/core';
import { BI_VISUAL_CONTEXT } from '@tasnim/bi/core';

type SlicerMode = 'dropdown' | 'list' | 'between' | 'relativeDate' | 'relativeTime' | 'boolean';
const MODES = new Set<string>(['dropdown', 'list', 'between', 'relativeDate', 'relativeTime', 'boolean']);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let nextId = 0;

/**
 * Power BI slicer: dropdown or list (multi- or single-select, with search),
 * between (numbers, dates, date-times), relative date (with presets), relative
 * time and a True / False toggle. Its values are narrowed by every other filter
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
  protected readonly presets = RELATIVE_DATE_PRESETS;

  readonly open = signal(false);
  readonly search = signal('');
  /** The custom relative date row stays open after "Custom…" even when the values match a preset. */
  readonly customRelative = signal(false);
  private readonly debouncedSearch = toSignal(toObservable(this.search).pipe(debounceTime(250)), { initialValue: '' });

  readonly field = computed(() => (this.ctx.definition().roles['field'] ?? []).find((i): i is GroupField => !isMeasureItem(i)) ?? null, { equal: sameJson });
  readonly column = computed(() => {
    const field = this.field();
    return field ? columnOf(this.ctx.model(), field) : undefined;
  });
  readonly mode = computed<SlicerMode>(() => {
    const configured = this.ctx.definition().options?.['mode'];
    if (typeof configured === 'string' && MODES.has(configured)) return configured as SlicerMode;
    const type = this.column()?.dataType;
    if (type === 'boolean') return 'boolean';
    return type === 'date' || type === 'datetime' || type === 'number' || type === 'integer' ? 'between' : 'dropdown';
  });
  readonly singleSelect = computed(() => this.ctx.definition().options?.['singleSelect'] === true);
  readonly inputType = computed(() => {
    const type = this.column()?.dataType;
    return type === 'datetime' ? 'datetime-local' : type === 'date' ? 'date' : 'number';
  });

  private readonly request = computed<ValuesRequest | undefined>(() => {
    const model = this.ctx.model();
    const context = this.ctx.filterContext();
    const field = this.field();
    const mode = this.mode();
    if (!model || !context || !field || mode === 'boolean' || mode === 'relativeTime') return undefined;
    const ranged = mode === 'between' || mode === 'relativeDate';
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
  readonly presetChoice = computed(() => {
    const r = this.relative();
    return r ? (presetLabel(r) ?? 'custom') : '';
  });
  readonly showCustom = computed(() => !!this.relative() && (this.customRelative() || this.presetChoice() === 'custom'));

  readonly relativeTime = computed<RelativeTimeFilter | null>(() => {
    const f = this.filter();
    return f?.kind === 'relativeTime' ? f : null;
  });

  readonly booleanChoice = computed<'all' | boolean | null | 'custom'>(() => {
    const f = this.filter();
    if (!f) return 'all';
    return f.kind === 'basic' && f.operator === 'in' && f.values.length === 1 ? f.values[0] as boolean | null : 'custom';
  });

  label(value: Scalar): string {
    return this.ctx.format(value, this.column()?.format, this.column()?.dataType);
  }

  /** Range edge as the input shows it: date-times need the "T" form. */
  inputEdge(value: Scalar | undefined): string {
    if (value === null || value === undefined) return '';
    return this.inputType() === 'datetime-local' ? toDateTimeInput(value) : String(value);
  }

  isSelected(value: Scalar): boolean {
    return this.selected().has(value);
  }

  toggle(value: Scalar): void {
    const field = this.field();
    if (!field) return;
    let next: Set<Scalar>;
    if (this.singleSelect()) {
      next = this.selected().has(value) ? new Set() : new Set([value]);
      this.open.set(false);
    } else {
      next = new Set(this.selected());
      if (next.has(value)) next.delete(value);
      else next.add(value);
    }
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

  choosePreset(choice: string): void {
    const field = this.field();
    if (!field) return;
    if (!choice) {
      this.customRelative.set(false);
      return this.publish(null);
    }
    if (choice === 'custom') {
      this.customRelative.set(true);
      if (!this.relative()) this.publish({ kind: 'relativeDate', target: fieldRef(field), period: 'last', count: 3, unit: 'month' });
      return;
    }
    const preset = this.presets.find((p) => p.label === choice);
    if (!preset) return;
    this.customRelative.set(false);
    const { includeToday, ...rest } = preset.value;
    this.publish({ kind: 'relativeDate', target: fieldRef(field), ...rest, ...(includeToday === false ? { includeToday } : {}) });
  }

  setRelative(change: Partial<Pick<RelativeDateFilter, 'period' | 'count' | 'unit' | 'includeToday'>>): void {
    const current = this.relative();
    if (!current) return;
    const next: RelativeDateFilter = { ...current, ...change };
    next.count = Math.max(1, Math.min(1000, Math.round(Number(next.count)) || 1));
    if (next.includeToday !== false) delete next.includeToday;
    this.publish(next);
  }

  setRelativeTime(change: Partial<Pick<RelativeTimeFilter, 'period' | 'count' | 'unit'>>): void {
    const field = this.field();
    if (!field) return;
    const current = this.relativeTime() ?? { kind: 'relativeTime' as const, target: fieldRef(field), period: 'last' as const, count: 24, unit: 'hour' as const };
    const count = Math.max(1, Math.min(100000, Math.round(Number(change.count ?? current.count)) || 1));
    this.publish({ ...current, ...change, count });
  }

  setBoolean(choice: 'all' | boolean): void {
    const field = this.field();
    if (!field) return;
    this.publish(choice === 'all' ? null : { kind: 'basic', target: fieldRef(field), operator: 'in', values: [choice] });
  }

  clear(): void {
    this.customRelative.set(false);
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

  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import {
  AdvancedOperator,
  BiFilter,
  Column,
  FieldRef,
  Scalar,
  SemanticModel,
} from '@tasnim/bi/core';
import { BI_DATA_SOURCE, describeError } from '@tasnim/bi/core';
import { formatValue } from '@tasnim/bi/core';

type Kind = BiFilter['kind'];

const OPERATORS: { value: AdvancedOperator; label: string; text?: boolean; noValue?: boolean }[] = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is greater than or equal to' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is less than or equal to' },
  { value: 'contains', label: 'contains', text: true },
  { value: 'notContains', label: "doesn't contain", text: true },
  { value: 'startsWith', label: 'starts with', text: true },
  { value: 'isBlank', label: 'is blank', noValue: true },
  { value: 'isNotBlank', label: 'is not blank', noValue: true },
];

/** Builds or edits one filter: basic list, advanced conditions, range, relative date or Top N — the Power BI filter card types. */
@Component({
  selector: 'bi-filter-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filter-editor.component.html',
  styleUrls: ['../../styles/controls.css', './filter-editor.component.css'],
})
export class FilterEditorComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  readonly model = input.required<SemanticModel>();
  readonly filter = input<BiFilter | null>(null);
  readonly allowFieldChange = input(true);
  readonly applied = output<BiFilter>();
  readonly cancelled = output<void>();

  readonly target = linkedSignal<FieldRef | null>(() => this.filter()?.target ?? null);
  readonly kind = linkedSignal<Kind>(() => this.filter()?.kind ?? 'basic');
  readonly basicOperator = linkedSignal<'in' | 'notIn'>(() => {
    const f = this.filter();
    return f?.kind === 'basic' ? f.operator : 'in';
  });
  readonly basicValues = linkedSignal<Scalar[]>(() => {
    const f = this.filter();
    return f?.kind === 'basic' ? [...f.values] : [];
  });
  readonly logic = linkedSignal<'and' | 'or'>(() => {
    const f = this.filter();
    return f?.kind === 'advanced' ? f.logic : 'and';
  });
  readonly conditions = linkedSignal<{ operator: AdvancedOperator; value: string }[]>(() => {
    const f = this.filter();
    return f?.kind === 'advanced'
      ? f.conditions.map((c) => ({ operator: c.operator, value: c.value === null || c.value === undefined ? '' : String(c.value) }))
      : [{ operator: 'eq', value: '' }];
  });
  readonly rangeMin = linkedSignal(() => {
    const f = this.filter();
    return f?.kind === 'range' && f.min !== null && f.min !== undefined ? String(f.min) : '';
  });
  readonly rangeMax = linkedSignal(() => {
    const f = this.filter();
    return f?.kind === 'range' && f.max !== null && f.max !== undefined ? String(f.max) : '';
  });
  readonly relPeriod = linkedSignal<'last' | 'this' | 'next'>(() => {
    const f = this.filter();
    return f?.kind === 'relativeDate' ? f.period : 'last';
  });
  readonly relCount = linkedSignal(() => {
    const f = this.filter();
    return f?.kind === 'relativeDate' ? f.count : 3;
  });
  readonly relUnit = linkedSignal<'day' | 'month' | 'year'>(() => {
    const f = this.filter();
    return f?.kind === 'relativeDate' ? f.unit : 'month';
  });
  readonly topDirection = linkedSignal<'top' | 'bottom'>(() => {
    const f = this.filter();
    return f?.kind === 'topN' ? f.direction : 'top';
  });
  readonly topN = linkedSignal(() => {
    const f = this.filter();
    return f?.kind === 'topN' ? f.n : 5;
  });
  readonly topBy = linkedSignal(() => {
    const f = this.filter();
    return f?.kind === 'topN' ? f.by : '';
  });

  readonly search = signal('');
  private readonly debouncedSearch = toSignal(toObservable(this.search).pipe(debounceTime(250)), { initialValue: '' });
  readonly error = signal<string | null>(null);

  readonly operators = OPERATORS;
  readonly tables = computed(() => this.model().tables.filter((t) => !t.hidden).map((t) => ({ name: t.name, columns: t.columns.filter((c) => !c.hidden) })));
  readonly column = computed<Column | undefined>(() => {
    const t = this.target();
    return t ? this.model().tables.find((x) => x.name === t.table)?.columns.find((c) => c.name === t.column) : undefined;
  });
  readonly isText = computed(() => this.column()?.dataType === 'text');
  readonly isDate = computed(() => this.column()?.dataType === 'date');
  readonly isNumeric = computed(() => ['number', 'integer'].includes(this.column()?.dataType ?? ''));
  readonly kinds = computed(() => {
    const list: { value: Kind; label: string }[] = [
      { value: 'basic', label: 'Basic filtering' },
      { value: 'advanced', label: 'Advanced filtering' },
    ];
    if (this.isDate() || this.isNumeric()) list.push({ value: 'range', label: 'Between' });
    if (this.isDate()) list.push({ value: 'relativeDate', label: 'Relative date' });
    list.push({ value: 'topN', label: 'Top N' });
    return list;
  });
  readonly measures = computed(() => this.model().measures);
  readonly inputType = computed(() => (this.isDate() ? 'date' : this.isNumeric() ? 'number' : 'text'));

  readonly values = rxResource({
    params: () => {
      const t = this.target();
      return t && this.kind() === 'basic' ? { modelId: this.model().id, target: t, filters: [], search: this.debouncedSearch() || undefined, limit: 200 } : undefined;
    },
    stream: ({ params }) => this.ds.values(params),
  });

  fieldKey(t: FieldRef | null): string {
    return t ? `${t.table}\u0000${t.column}` : '';
  }

  selectField(key: string): void {
    const [table, column] = key.split('\u0000');
    this.target.set(table && column ? { table, column } : null);
    this.basicValues.set([]);
    this.search.set('');
    if (!this.kinds().some((k) => k.value === this.kind())) this.kind.set('basic');
  }

  label(value: Scalar): string {
    return formatValue(value, this.column()?.format, this.column()?.dataType);
  }

  toggleValue(value: Scalar): void {
    this.basicValues.update((vs) => (vs.includes(value) ? vs.filter((v) => v !== value) : [...vs, value]));
  }

  setCondition(index: number, change: Partial<{ operator: AdvancedOperator; value: string }>): void {
    this.conditions.update((cs) => cs.map((c, i) => (i === index ? { ...c, ...change } : c)));
  }

  addCondition(): void {
    this.conditions.update((cs) => (cs.length < 2 ? [...cs, { operator: 'eq', value: '' }] : cs));
  }

  removeCondition(index: number): void {
    this.conditions.update((cs) => cs.filter((_, i) => i !== index));
  }

  noValue(op: AdvancedOperator): boolean {
    return !!OPERATORS.find((o) => o.value === op)?.noValue;
  }

  private typed(raw: string): Scalar {
    if (raw === '') return null;
    return this.isNumeric() ? Number(raw) : raw;
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  apply(): void {
    const target = this.target();
    this.error.set(null);
    if (!target) return this.error.set('Choose a field to filter.');
    const base = { id: this.filter()?.id, target, scope: this.filter()?.scope };
    let filter: BiFilter;
    switch (this.kind()) {
      case 'basic':
        filter = { ...base, kind: 'basic', operator: this.basicOperator(), values: this.basicValues() };
        break;
      case 'advanced': {
        const conditions = this.conditions().map((c) => ({ operator: c.operator, value: this.noValue(c.operator) ? undefined : this.typed(c.value) }));
        if (conditions.some((c, i) => !this.noValue(c.operator) && this.conditions()[i].value === '')) return this.error.set('Enter a value for each condition.');
        filter = { ...base, kind: 'advanced', logic: this.logic(), conditions };
        break;
      }
      case 'range':
        filter = { ...base, kind: 'range', min: this.typed(this.rangeMin()), max: this.typed(this.rangeMax()) };
        break;
      case 'relativeDate':
        filter = { ...base, kind: 'relativeDate', period: this.relPeriod(), count: Math.max(1, Math.round(this.relCount()) || 1), unit: this.relUnit() };
        break;
      case 'topN':
        if (!this.topBy()) return this.error.set('Choose the measure to rank by.');
        filter = { ...base, kind: 'topN', direction: this.topDirection(), n: Math.max(1, Math.round(this.topN()) || 1), by: this.topBy() };
        break;
    }
    this.applied.emit(filter);
  }

  valuesError(): string | null {
    return this.values.error() ? describeError(this.values.error(), "Values couldn't be loaded.") : null;
  }
}

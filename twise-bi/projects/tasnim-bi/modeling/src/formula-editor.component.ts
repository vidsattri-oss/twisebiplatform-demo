import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, debounceTime, defer, map, of, startWith, switchMap } from 'rxjs';
import {
  BI_DATA_SOURCE,
  DataType,
  ExpressionKind,
  ExpressionPreview,
  MeasureValidateResult,
  Scalar,
  SemanticModel,
  describeError,
  errorPosition,
  formatValue,
} from '@tasnim/bi/core';
import { FUNCTION_GROUPS } from './formula-functions';

const TYPE_LABELS: Record<DataType, string> = { number: 'a number', integer: 'a whole number', text: 'text', boolean: 'true / false', date: 'a date', datetime: 'a date and time' };

interface Check {
  validation: MeasureValidateResult;
  preview: ExpressionPreview | null;
  previewError: string | null;
}

export interface FormulaSaved {
  kind: ExpressionKind;
  name: string;
  table: string;
}

/** The table most measures live on — usually the fact table — rather than the alphabetical first. */
export function busiestTable(model: SemanticModel): string {
  const counts = new Map<string, number>();
  for (const m of model.measures) counts.set(m.table, (counts.get(m.table) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? model.tables.find((t) => !t.hidden)?.name ?? '';
}

/**
 * The formula editor (E2): DAX-style measures and calculated columns, validated
 * by the server as you type, with the error position marked, the result type
 * named and a preview. Used by the Formulas page and by the Data pane inside the
 * report editor (compact layout).
 */
@Component({
  selector: 'bi-formula-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './formula-editor.component.html',
  styleUrls: ['../../styles/controls.css', './formula-editor.component.css'],
})
export class FormulaEditorComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  readonly model = input.required<SemanticModel>();
  readonly kind = input<ExpressionKind>('measure');
  readonly initialTable = input('');
  /** Single column for narrow panes. */
  readonly compact = input(false);
  readonly showCancel = input(false);
  readonly saved = output<FormulaSaved>();
  readonly cancelled = output<void>();

  protected readonly activeKind = linkedSignal(() => this.kind());
  /** Keeps the chosen table when the model reloads after a save; falls back when it no longer exists. */
  protected readonly table = linkedSignal<{ model: SemanticModel; initial: string }, string>({
    source: () => ({ model: this.model(), initial: this.initialTable() }),
    computation: (source, previous) =>
      previous && source.model.tables.some((t) => t.name === previous.value) ? previous.value : source.initial || busiestTable(source.model),
  });
  protected readonly columns = computed(() => this.model().tables.find((t) => t.name === this.table())?.columns.filter((c) => !c.hidden) ?? []);
  protected readonly sameTableMeasures = computed(() => this.model().measures.filter((m) => m.table === this.table()));

  protected readonly functionSearch = signal('');
  protected readonly functionGroups = computed(() => {
    const q = this.functionSearch().trim().toLowerCase();
    return FUNCTION_GROUPS.map((g) => ({ ...g, functions: g.functions.filter((f) => !q || f.name.toLowerCase().includes(q) || f.help.toLowerCase().includes(q)) })).filter((g) => g.functions.length);
  });

  protected readonly name = signal('');
  protected readonly format = signal('#,0');
  protected readonly expression = signal('');
  protected readonly saving = signal(false);
  protected readonly message = signal<{ kind: 'error' | 'success'; text: string } | null>(null);

  private readonly checkInput = computed(() => ({ modelId: this.model().id, table: this.table(), expression: this.expression(), kind: this.activeKind() }));
  protected readonly check = toSignal(
    toObservable(this.checkInput).pipe(
      debounceTime(400),
      switchMap(({ modelId, table, expression, kind }): Observable<Check | null> => {
        if (!table || !expression.trim()) return of(null);
        return this.ds.validateMeasure(modelId, table, expression, kind).pipe(
          // A failed request must not end the stream: toSignal would rethrow on every read and freeze the editor.
          catchError((err: unknown) => of<MeasureValidateResult>({ ok: false, error: { error: describeError(err, "The expression couldn't be checked right now. Keep typing to try again.") } })),
          switchMap((validation): Observable<Check> => {
            if (!validation.ok) return of({ validation, preview: null, previewError: null });
            return defer(() => this.ds.previewExpression(modelId, table, expression, kind)).pipe(
              map((preview): Check => ({ validation, preview, previewError: null })),
              catchError((err: unknown) => of<Check>({ validation, preview: null, previewError: describeError(err, "The result couldn't be previewed.") })),
              startWith<Check>({ validation, preview: null, previewError: null }),
            );
          }),
        );
      }),
    ),
    { initialValue: null },
  );
  protected readonly validation = computed(() => this.check()?.validation ?? null);

  protected readonly errorMarker = computed(() => {
    const v = this.validation();
    const position = v && !v.ok ? v.error?.position : undefined;
    const text = this.expression();
    if (position === undefined || position > text.length) return null;
    return { before: text.slice(0, position), at: text.slice(position, position + 1) || ' ', after: text.slice(position + 1) };
  });

  protected setKind(kind: ExpressionKind): void {
    this.activeKind.set(kind);
    this.message.set(null);
  }

  protected typeLabel(type: DataType | undefined): string {
    return type ? TYPE_LABELS[type] : 'a value';
  }

  protected previewValue(p: ExpressionPreview): string {
    const numeric = p.dataType === 'number' || p.dataType === 'integer';
    return formatValue(p.value ?? null, numeric ? this.format() || undefined : undefined, p.dataType);
  }

  protected cell(value: Scalar): string {
    return formatValue(value);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  protected tableRef(table: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ? table : `'${table.replace(/'/g, "''")}'`;
  }

  protected insert(textarea: HTMLTextAreaElement, snippet: string): void {
    const start = textarea.selectionStart ?? this.expression().length;
    const end = textarea.selectionEnd ?? start;
    this.expression.set(this.expression().slice(0, start) + snippet + this.expression().slice(end));
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  protected save(): void {
    const name = this.name().trim();
    const kind = this.activeKind();
    const table = this.table();
    this.message.set(null);
    if (!name || !this.expression().trim()) {
      this.message.set({ kind: 'error', text: `Name the ${kind === 'measure' ? 'measure' : 'column'} and write an expression.` });
      return;
    }
    const input = { table, name, expression: this.expression(), format: this.format() || undefined };
    const request: Observable<{ name: string }> = kind === 'measure' ? this.ds.createMeasure(this.model().id, input) : this.ds.createColumn(this.model().id, input);
    this.saving.set(true);
    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.message.set({
          kind: 'success',
          text: kind === 'measure'
            ? `Saved [${saved.name}]. It's available in every report on this model.`
            : `Added ${table}[${saved.name}]. Use it in axes, slicers, filters and measures like any other column.`,
        });
        this.name.set('');
        this.expression.set('');
        this.saved.emit({ kind, name: saved.name, table });
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const position = errorPosition(err);
        this.message.set({ kind: 'error', text: describeError(err, `The ${kind === 'measure' ? 'measure' : 'column'} couldn't be saved.`) + (position !== undefined ? ` (at character ${position + 1})` : '') });
      },
    });
  }
}

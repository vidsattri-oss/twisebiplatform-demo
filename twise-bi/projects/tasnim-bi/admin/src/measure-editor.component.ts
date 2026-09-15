import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, debounceTime, defer, map, of, startWith, switchMap } from 'rxjs';
import { DataType, ExpressionKind, ExpressionPreview, MeasureValidateResult, Scalar, formatValue } from '@tasnim/bi/core';
import { BI_DATA_SOURCE, describeError, errorPosition } from '@tasnim/bi/core';
import { BiNavComponent } from '@tasnim/bi/report';

interface FunctionHelp {
  name: string;
  snippet: string;
  help: string;
  /** Aggregations and iterators only make sense in a measure. */
  measureOnly?: boolean;
}

const FUNCTION_GROUPS: { label: string; functions: FunctionHelp[] }[] = [
  {
    label: 'Aggregation',
    functions: [
      { name: 'COUNTROWS', snippet: 'COUNTROWS(Table)', help: 'Counts the rows of the home table.', measureOnly: true },
      { name: 'SUM', snippet: 'SUM(Table[Column])', help: 'Adds a numeric column.', measureOnly: true },
      { name: 'AVERAGE', snippet: 'AVERAGE(Table[Column])', help: 'Averages a numeric column.', measureOnly: true },
      { name: 'MIN', snippet: 'MIN(Table[Column])', help: 'Smallest value.', measureOnly: true },
      { name: 'MAX', snippet: 'MAX(Table[Column])', help: 'Largest value.', measureOnly: true },
      { name: 'DISTINCTCOUNT', snippet: 'DISTINCTCOUNT(Table[Column])', help: 'Counts distinct values.', measureOnly: true },
      { name: 'COUNTBLANK', snippet: 'COUNTBLANK(Table[Column])', help: 'Counts blank values.', measureOnly: true },
    ],
  },
  {
    label: 'Iterators',
    functions: [
      { name: 'SUMX', snippet: 'SUMX(Table, Table[Column] * 2)', help: 'Works out the expression for each row, then adds the results.', measureOnly: true },
      { name: 'AVERAGEX', snippet: 'AVERAGEX(Table, Table[Column])', help: 'Averages a per-row expression.', measureOnly: true },
      { name: 'MINX', snippet: 'MINX(Table, Table[Column])', help: 'Smallest per-row result.', measureOnly: true },
      { name: 'MAXX', snippet: 'MAXX(Table, Table[Column])', help: 'Largest per-row result.', measureOnly: true },
      { name: 'COUNTX', snippet: 'COUNTX(Table, Table[Column])', help: 'Counts rows where the expression is not blank.', measureOnly: true },
    ],
  },
  {
    label: 'Logical',
    functions: [
      { name: 'IF', snippet: 'IF(condition, "Yes", "No")', help: 'One result when the condition is true, another when it is false.' },
      { name: 'SWITCH', snippet: 'SWITCH(TRUE(), condition, "A", "Otherwise")', help: 'The first matching branch. SWITCH(value, match, result, …) compares one value.' },
      { name: 'AND', snippet: 'AND(condition, condition)', help: 'True when both are true. Also written &&.' },
      { name: 'OR', snippet: 'OR(condition, condition)', help: 'True when either is true. Also written ||.' },
      { name: 'NOT', snippet: 'NOT(condition)', help: 'Reverses true and false.' },
      { name: 'ISBLANK', snippet: 'ISBLANK(value)', help: 'True when the value is blank.' },
      { name: 'BLANK', snippet: 'BLANK()', help: 'A blank value.' },
    ],
  },
  {
    label: 'Text',
    functions: [
      { name: '&', snippet: ' & ', help: 'Joins text: [Status] & " (" & [Count] & ")".' },
      { name: 'CONCATENATE', snippet: 'CONCATENATE(text, text)', help: 'Joins two pieces of text.' },
      { name: 'LEFT', snippet: 'LEFT(text, 3)', help: 'The first characters.' },
      { name: 'RIGHT', snippet: 'RIGHT(text, 3)', help: 'The last characters.' },
      { name: 'MID', snippet: 'MID(text, 2, 3)', help: 'Characters from a start position.' },
      { name: 'LEN', snippet: 'LEN(text)', help: 'Number of characters.' },
      { name: 'UPPER', snippet: 'UPPER(text)', help: 'Capital letters.' },
      { name: 'LOWER', snippet: 'LOWER(text)', help: 'Small letters.' },
      { name: 'TRIM', snippet: 'TRIM(text)', help: 'Removes spaces at the start and end.' },
      { name: 'FORMAT', snippet: 'FORMAT(value, "0.0%")', help: 'Number or date as text: "#,0.0", "0%", "dd MMM yyyy".' },
    ],
  },
  {
    label: 'Date',
    functions: [
      { name: 'TODAY', snippet: 'TODAY()', help: "Today's date (UTC)." },
      { name: 'NOW', snippet: 'NOW()', help: 'The current date and time (UTC).' },
      { name: 'DATE', snippet: 'DATE(2026, 1, 31)', help: 'A date from year, month and day.' },
      { name: 'YEAR', snippet: 'YEAR(date)', help: 'The year number.' },
      { name: 'MONTH', snippet: 'MONTH(date)', help: 'The month number, 1 to 12.' },
      { name: 'DAY', snippet: 'DAY(date)', help: 'The day of the month.' },
      { name: 'WEEKDAY', snippet: 'WEEKDAY(date, 2)', help: 'Day of the week; 2 means Monday = 1.' },
      { name: 'DATEDIFF', snippet: 'DATEDIFF(start, end, DAY)', help: 'Intervals between two dates: DAY, WEEK, MONTH, QUARTER, YEAR, HOUR, MINUTE, SECOND.' },
      { name: 'EOMONTH', snippet: 'EOMONTH(date, 0)', help: 'Last day of the month, months ahead or back.' },
    ],
  },
  {
    label: 'Math',
    functions: [{ name: 'DIVIDE', snippet: 'DIVIDE(numerator, denominator)', help: 'Division that returns blank instead of an error on zero.' }],
  },
];

const TYPE_LABELS: Record<DataType, string> = { number: 'a number', integer: 'a whole number', text: 'text', boolean: 'true / false', date: 'a date', datetime: 'a date and time' };

interface Check {
  validation: MeasureValidateResult;
  preview: ExpressionPreview | null;
  previewError: string | null;
}

/**
 * Feature 03: the formula editor. DAX-style measures and calculated columns,
 * validated by the server as you type (the same compiler that runs the query),
 * with the error position marked, the result type named and the result previewed.
 */
@Component({
  selector: 'bi-measure-editor',
  imports: [BiNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './measure-editor.component.html',
  styleUrls: ['../../styles/tokens.css', '../../styles/controls.css', '../../styles/page.css', './measure-editor.component.css'],
})
export class MeasureEditorComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  protected readonly models = rxResource({ stream: () => this.ds.listModels() });
  protected readonly modelId = signal<number | null>(null);
  protected readonly activeModelId = computed(() => this.modelId() ?? this.models.value()?.find((m) => m.status === 'connected')?.id ?? null);
  protected readonly model = rxResource({ params: () => this.activeModelId() ?? undefined, stream: ({ params }) => this.ds.getModel(params) });

  protected readonly kind = signal<ExpressionKind>('measure');
  protected readonly table = signal('');
  /** Defaults to the table most existing measures live on — usually the fact table — rather than the alphabetical first. */
  protected readonly activeTable = computed(() => {
    if (this.table()) return this.table();
    const model = this.model.value();
    if (!model) return '';
    const counts = new Map<string, number>();
    for (const m of model.measures) counts.set(m.table, (counts.get(m.table) ?? 0) + 1);
    const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return busiest ?? model.tables[0]?.name ?? '';
  });
  protected readonly columns = computed(() => this.model.value()?.tables.find((t) => t.name === this.activeTable())?.columns.filter((c) => !c.hidden) ?? []);
  protected readonly sameTableMeasures = computed(() => (this.model.value()?.measures ?? []).filter((m) => m.table === this.activeTable()));
  protected readonly calculatedColumns = computed(() =>
    (this.model.value()?.tables ?? []).flatMap((t) => t.columns.filter((c) => c.expression).map((c) => ({ ...c, table: t.name }))),
  );

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
  protected readonly confirmDelete = signal<string | null>(null);

  private readonly checkInput = computed(() => ({ modelId: this.activeModelId(), table: this.activeTable(), expression: this.expression(), kind: this.kind() }));
  protected readonly check = toSignal(
    toObservable(this.checkInput).pipe(
      debounceTime(400),
      switchMap(({ modelId, table, expression, kind }): Observable<Check | null> => {
        if (modelId === null || !table || !expression.trim()) return of(null);
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
    this.kind.set(kind);
    this.message.set(null);
  }

  protected typeLabel(type: DataType | undefined): string {
    return type ? TYPE_LABELS[type] : 'a value';
  }

  /** A preview value in the chosen format when the result is a number. */
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
    const next = this.expression().slice(0, start) + snippet + this.expression().slice(end);
    this.expression.set(next);
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  protected save(): void {
    const modelId = this.activeModelId();
    const name = this.name().trim();
    const kind = this.kind();
    this.message.set(null);
    if (modelId === null || !name || !this.expression().trim()) {
      this.message.set({ kind: 'error', text: `Name the ${kind === 'measure' ? 'measure' : 'column'} and write an expression.` });
      return;
    }
    const input = { table: this.activeTable(), name, expression: this.expression(), format: this.format() || undefined };
    const request: Observable<{ name: string }> = kind === 'measure' ? this.ds.createMeasure(modelId, input) : this.ds.createColumn(modelId, input);
    this.saving.set(true);
    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.message.set({
          kind: 'success',
          text: kind === 'measure'
            ? `Saved [${saved.name}]. It's available in every report on this model.`
            : `Added ${input.table}[${saved.name}]. Use it in axes, slicers, filters and measures like any other column.`,
        });
        this.name.set('');
        this.expression.set('');
        this.model.reload();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const position = errorPosition(err);
        this.message.set({ kind: 'error', text: describeError(err, `The ${kind === 'measure' ? 'measure' : 'column'} couldn't be saved.`) + (position !== undefined ? ` (at character ${position + 1})` : '') });
      },
    });
  }

  protected remove(kind: ExpressionKind, id: number): void {
    const modelId = this.activeModelId();
    this.confirmDelete.set(null);
    if (modelId === null) return;
    const request = kind === 'measure' ? this.ds.deleteMeasure(modelId, id) : this.ds.deleteColumn(modelId, id);
    request.subscribe({
      next: () => this.model.reload(),
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "It couldn't be deleted.") }),
    });
  }
}

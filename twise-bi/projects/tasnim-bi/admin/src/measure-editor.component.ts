import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, of, switchMap } from 'rxjs';
import { MeasureValidateResult } from '@tasnim/bi/core';
import { BI_DATA_SOURCE, describeError, errorPosition } from '@tasnim/bi/core';
import { BiNavComponent } from '@tasnim/bi/report';

const FUNCTIONS = [
  { name: 'COUNTROWS', snippet: 'COUNTROWS(Table)', help: 'Counts rows of the home table.' },
  { name: 'SUM', snippet: 'SUM(Table[Column])', help: 'Adds a numeric column.' },
  { name: 'AVERAGE', snippet: 'AVERAGE(Table[Column])', help: 'Averages a numeric column.' },
  { name: 'MIN', snippet: 'MIN(Table[Column])', help: 'Smallest value.' },
  { name: 'MAX', snippet: 'MAX(Table[Column])', help: 'Largest value.' },
  { name: 'DISTINCTCOUNT', snippet: 'DISTINCTCOUNT(Table[Column])', help: 'Counts distinct values.' },
  { name: 'DIVIDE', snippet: 'DIVIDE(numerator, denominator)', help: 'Division that returns blank on zero.' },
];

/**
 * Feature 03: DAX-subset measures. Validated by the server as you type (the
 * same compiler that runs the query), with the error position marked, and
 * evaluated per group in each visual's filter context once saved.
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

  protected readonly functions = FUNCTIONS;
  protected readonly models = rxResource({ stream: () => this.ds.listModels() });
  protected readonly modelId = signal<number | null>(null);
  protected readonly activeModelId = computed(() => this.modelId() ?? this.models.value()?.find((m) => m.status === 'connected')?.id ?? null);
  protected readonly model = rxResource({ params: () => this.activeModelId() ?? undefined, stream: ({ params }) => this.ds.getModel(params) });

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

  protected readonly name = signal('');
  protected readonly format = signal('#,0');
  protected readonly expression = signal('');
  protected readonly saving = signal(false);
  protected readonly message = signal<{ kind: 'error' | 'success'; text: string } | null>(null);
  protected readonly confirmDeleteId = signal<number | null>(null);

  private readonly validationInput = computed(() => ({ modelId: this.activeModelId(), table: this.activeTable(), expression: this.expression() }));
  protected readonly validation = toSignal(
    toObservable(this.validationInput).pipe(
      debounceTime(400),
      switchMap(({ modelId, table, expression }) =>
        modelId !== null && table && expression.trim()
          ? this.ds.validateMeasure(modelId, table, expression).pipe(
              // A failed request must not end the stream: toSignal would rethrow on every read and freeze the editor.
              catchError((err: unknown) => of<MeasureValidateResult>({ ok: false, error: { error: describeError(err, "The expression couldn't be checked right now. Keep typing to try again.") } })),
            )
          : of<MeasureValidateResult | null>(null),
      ),
    ),
    { initialValue: null },
  );

  protected readonly errorMarker = computed(() => {
    const v = this.validation();
    const position = v && !v.ok ? v.error?.position : undefined;
    const text = this.expression();
    if (position === undefined || position > text.length) return null;
    return { before: text.slice(0, position), at: text.slice(position, position + 1) || ' ', after: text.slice(position + 1) };
  });

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
    this.message.set(null);
    if (modelId === null || !name || !this.expression().trim()) {
      this.message.set({ kind: 'error', text: 'Name the measure and write an expression.' });
      return;
    }
    this.saving.set(true);
    this.ds.createMeasure(modelId, { table: this.activeTable(), name, expression: this.expression(), format: this.format() || undefined }).subscribe({
      next: (m) => {
        this.saving.set(false);
        this.message.set({ kind: 'success', text: `Saved [${m.name}]. It's available in every report on this model.` });
        this.name.set('');
        this.expression.set('');
        this.model.reload();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const position = errorPosition(err);
        this.message.set({ kind: 'error', text: describeError(err, "The measure couldn't be saved.") + (position !== undefined ? ` (at character ${position + 1})` : '') });
      },
    });
  }

  protected remove(id: number): void {
    const modelId = this.activeModelId();
    this.confirmDeleteId.set(null);
    if (modelId === null) return;
    this.ds.deleteMeasure(modelId, id).subscribe({
      next: () => this.model.reload(),
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The measure couldn't be deleted.") }),
    });
  }
}

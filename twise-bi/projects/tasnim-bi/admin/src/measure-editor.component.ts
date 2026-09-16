import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { BI_DATA_SOURCE, ExpressionKind, describeError } from '@tasnim/bi/core';
import { FormulaEditorComponent, FormulaSaved } from '@tasnim/bi/modeling';
import { BiNavComponent } from '@tasnim/bi/report';

/**
 * Feature 03: the Formulas page — the shared formula editor (E2) for a chosen
 * data source, plus every measure and calculated column on it. The same editor
 * opens from the Data pane inside the report editor.
 */
@Component({
  selector: 'bi-measure-editor',
  imports: [BiNavComponent, FormulaEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './measure-editor.component.html',
  styleUrls: ['../../styles/tokens.css', '../../styles/controls.css', '../../styles/page.css', './measure-editor.component.css'],
})
export class MeasureEditorComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  protected readonly models = rxResource({ stream: () => this.ds.listModels() });
  protected readonly modelsError = computed(() => (this.models.error() ? describeError(this.models.error(), "The data sources couldn't be loaded.") : null));
  protected readonly modelId = signal<number | null>(null);
  protected readonly activeModelId = computed(() => this.modelId() ?? this.models.value()?.find((m) => m.status === 'connected')?.id ?? null);
  protected readonly model = rxResource({ params: () => this.activeModelId() ?? undefined, stream: ({ params }) => this.ds.getModel(params) });
  protected readonly modelError = computed(() => (this.model.error() ? describeError(this.model.error(), "The selected model couldn't be loaded.") : null));
  protected readonly calculatedColumns = computed(() =>
    (this.model.value()?.tables ?? []).flatMap((t) => t.columns.filter((c) => c.expression).map((c) => ({ ...c, table: t.name }))),
  );

  protected readonly message = signal<{ kind: 'error' | 'success'; text: string } | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);

  protected valueOf(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected onSaved(_saved: FormulaSaved): void {
    this.model.reload();
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

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GroupField, RowsRequest, fieldRef, isMeasureItem } from '../core/contract';
import { columnOf } from '../core/describe-filter';
import { GridColumn } from '../report/report-store';
import { RowsGridComponent } from './rows-grid.component';
import { BI_VISUAL_CONTEXT } from './visual-context';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Power BI's Table visual: detail rows for the chosen columns under every filter on the page. */
@Component({
  selector: 'bi-table-visual',
  imports: [RowsGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bi-rows-grid class="grid" [request]="request()" [columns]="columns()" (total)="total.set($event)" (failed)="error.set($event)" />
    <div class="foot" aria-live="polite">
      @if (error(); as message) {
        <span class="error">{{ message }}</span>
      } @else if (total() !== null) {
        {{ total()!.toLocaleString('en-US') }} rows
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; gap: 6px; }
    .grid { flex: 1; min-height: 120px; }
    .foot { font-size: 12px; color: var(--bi-muted); font-variant-numeric: tabular-nums; }
    .error { color: var(--bi-danger); }
  `,
})
export class TableVisualComponent {
  private readonly ctx = inject(BI_VISUAL_CONTEXT);
  readonly total = signal<number | null>(null);
  readonly error = signal<string | null>(null);

  private readonly fields = computed(
    () => (this.ctx.definition().roles['columns'] ?? []).filter((item): item is GroupField => !isMeasureItem(item)),
    { equal: sameJson },
  );

  readonly columns = computed<GridColumn[]>(() => {
    const model = this.ctx.model();
    return this.fields().map((f) => {
      const col = columnOf(model, f);
      return { name: f.column, dataType: col?.dataType ?? 'text', format: col?.format };
    });
  }, { equal: sameJson });

  readonly request = computed<RowsRequest | null>(() => {
    const model = this.ctx.model();
    const context = this.ctx.filterContext();
    const fields = this.fields();
    if (!model || !context || !fields.length) return null;
    return { modelId: model.id, columns: fields.map(fieldRef), filters: context.filters };
  }, { equal: sameJson });
}

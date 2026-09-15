import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GroupField, RowsRequest, Scalar, fieldRef, isMeasureItem } from '@tasnim/bi/core';
import { columnOf } from '@tasnim/bi/core';
import { GridColumn } from '@tasnim/bi/core';
import { RowsGridComponent } from './rows-grid.component';
import { BI_VISUAL_CONTEXT } from '@tasnim/bi/core';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Power BI's Table visual: detail rows for the chosen columns under every filter
 * on the page. A row click cross-filters the other visuals by the row's first
 * column (Ctrl/Cmd adds rows); right-click offers Include and Exclude.
 */
@Component({
  selector: 'bi-table-visual',
  imports: [RowsGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bi-rows-grid
      class="grid"
      [request]="request()"
      [columns]="columns()"
      [selectable]="true"
      [selectedKeys]="selectedKeys()"
      (total)="total.set($event)"
      (failed)="error.set($event)"
      (rowSelected)="ctx.select([$event.value], $event.additive)"
      (rowMenu)="ctx.openDataPointMenu([$event.value], $event.event)"
    />
    <div class="foot" aria-live="polite">
      @if (error(); as message) {
        <span class="error">{{ message }}</span>
      } @else if (total() !== null) {
        {{ total()!.toLocaleString('en-US') }} rows
        @if (selectedKeys(); as keys) {
          <span class="selected">· {{ keys.size }} {{ firstColumn() }} selected — click a row again to clear</span>
        }
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; gap: 6px; }
    .grid { flex: 1; min-height: 120px; }
    .foot { font-size: 12px; color: var(--bi-muted); font-variant-numeric: tabular-nums; }
    .selected { color: var(--bi-accent-strong); }
    .error { color: var(--bi-danger); }
  `,
})
export class TableVisualComponent {
  protected readonly ctx = inject(BI_VISUAL_CONTEXT);
  readonly total = signal<number | null>(null);
  readonly error = signal<string | null>(null);

  private readonly fields = computed(
    () => (this.ctx.definition().roles['columns'] ?? []).filter((item): item is GroupField => !isMeasureItem(item)),
    { equal: sameJson },
  );
  readonly firstColumn = computed(() => this.fields()[0]?.column ?? '');

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

  /** This table's own selection. Rows stay visible — the source visual is never filtered by itself (I4). */
  readonly selectedKeys = computed<ReadonlySet<Scalar> | null>(() => {
    const s = this.ctx.selection();
    return s && s.visualId === this.ctx.definition().id ? new Set(s.values) : null;
  });
}

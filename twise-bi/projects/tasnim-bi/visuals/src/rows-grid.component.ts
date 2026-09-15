import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule,
  CellContextMenuEvent,
  ColDef,
  GridApi,
  IDatasource,
  Module,
  RowClassParams,
  RowClickedEvent,
  RowStyle,
  themeQuartz,
} from 'ag-grid-community';
import { Subscription } from 'rxjs';
import { RowsRequest, Scalar } from '@tasnim/bi/core';
import { BI_DATA_SOURCE, describeError } from '@tasnim/bi/core';
import { formatValue } from '@tasnim/bi/core';
import { GridColumn } from '@tasnim/bi/core';

const PAGE_SIZE = 100;

/** Styled to the Al Tasnim logo: logo-blue header, white text, neutral grey borders. */
export const BI_GRID_THEME = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  accentColor: '#2841A3',
  headerBackgroundColor: '#2841A3',
  headerTextColor: '#FFFFFF',
  headerFontWeight: 600,
  borderColor: '#DDDCE2',
  foregroundColor: '#1D1C21',
  rowHoverColor: '#EEF1FA',
  oddRowBackgroundColor: '#F9F9FB',
  wrapperBorderRadius: 8,
});

type DisposableDatasource = IDatasource & { dispose(): void };

/**
 * Detail rows paged from the server (AG Grid infinite row model), so a table
 * visual or See records never downloads the whole table or silently stops at
 * a fixed row count.
 */
@Component({
  selector: 'bi-rows-grid',
  imports: [AgGridAngular],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ag-grid-angular
      class="grid"
      [theme]="theme"
      [modules]="modules"
      [rowModelType]="rowModelType"
      [datasource]="datasource()"
      [columnDefs]="columnDefs()"
      [defaultColDef]="defaultColDef"
      [cacheBlockSize]="pageSize"
      [maxBlocksInCache]="20"
      [getRowStyle]="rowStyle"
      [preventDefaultOnContextMenu]="selectable()"
      [class.selectable]="selectable()"
      (gridReady)="api = $event.api"
      (rowClicked)="onRowClicked($event)"
      (cellContextMenu)="onContextMenu($event)"
    />
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .grid { display: block; width: 100%; height: 100%; }
  `,
})
export class RowsGridComponent {
  private readonly ds = inject(BI_DATA_SOURCE);
  protected api: GridApi | null = null;

  readonly request = input.required<RowsRequest | null>();
  readonly columns = input.required<GridColumn[]>();
  /** Rows become selection sources (C1): click selects by the first column's value, Ctrl/Cmd adds. */
  readonly selectable = input(false);
  /** First-column values of the selected rows; those rows are shaded. */
  readonly selectedKeys = input<ReadonlySet<Scalar> | null>(null);
  readonly total = output<number>();
  readonly failed = output<string>();
  readonly rowSelected = output<{ value: Scalar; additive: boolean }>();
  readonly rowMenu = output<{ value: Scalar; event: MouseEvent }>();

  protected readonly rowStyle = (params: RowClassParams): RowStyle | undefined => {
    const keys = this.selectedKeys();
    return keys && params.data && keys.has(params.data['c0'] as Scalar)
      ? { background: 'var(--bi-accent-tint, #FDF3E6)', boxShadow: 'inset 3px 0 0 var(--bi-accent, #E38200)' }
      : undefined;
  };

  protected onRowClicked(e: RowClickedEvent): void {
    if (!this.selectable() || !e.data) return;
    const mouse = e.event as MouseEvent | null | undefined;
    this.rowSelected.emit({ value: (e.data['c0'] ?? null) as Scalar, additive: !!(mouse?.ctrlKey || mouse?.metaKey) });
  }

  protected onContextMenu(e: CellContextMenuEvent): void {
    const mouse = e.event as MouseEvent | null | undefined;
    if (!this.selectable() || !e.data || !mouse) return;
    this.rowMenu.emit({ value: (e.data['c0'] ?? null) as Scalar, event: mouse });
  }

  protected readonly theme = BI_GRID_THEME;
  protected readonly modules: Module[] = [AllCommunityModule];
  protected readonly rowModelType = 'infinite' as const;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly defaultColDef: ColDef = { sortable: false, resizable: true, minWidth: 110, flex: 1 };

  protected readonly columnDefs = computed<ColDef[]>(() =>
    this.columns().map((col, i) => ({
      headerName: col.name,
      field: `c${i}`,
      type: col.dataType === 'number' || col.dataType === 'integer' ? 'rightAligned' : undefined,
      valueFormatter: (p) => (p.data ? formatValue(p.value ?? null, col.format, col.dataType) : ''),
    })),
  );

  protected readonly datasource = computed<DisposableDatasource | undefined>(() => {
    const request = this.request();
    if (!request) return undefined;
    const subscriptions = new Subscription();
    return {
      getRows: (params) => {
        subscriptions.add(
          this.ds.rows({ ...request, offset: params.startRow, limit: params.endRow - params.startRow }).subscribe({
            next: (res) => {
              this.total.emit(res.total);
              params.successCallback(res.rows.map((row) => Object.fromEntries(row.map((v, i) => [`c${i}`, v]))), res.total);
            },
            error: (err: unknown) => {
              this.failed.emit(describeError(err, "Rows couldn't be loaded."));
              params.failCallback();
            },
          }),
        );
      },
      dispose: () => subscriptions.unsubscribe(),
    };
  }, { equal: (a, b) => a === b });

  constructor() {
    // A new request replaces the datasource; cancel the old one's in-flight pages (I7).
    effect((onCleanup) => {
      const current = this.datasource();
      onCleanup(() => current?.dispose());
    });
    // Re-style rendered rows when the selection changes; cached pages are not refetched.
    effect(() => {
      this.selectedKeys();
      this.api?.redrawRows();
    });
  }
}

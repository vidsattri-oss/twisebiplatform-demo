import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, IDatasource, Module, themeQuartz } from 'ag-grid-community';
import { Subscription } from 'rxjs';
import { RowsRequest } from '@tasnim/bi/core';
import { BI_DATA_SOURCE, describeError } from '@tasnim/bi/core';
import { formatValue } from '@tasnim/bi/core';
import { GridColumn } from '@tasnim/bi/core';

const PAGE_SIZE = 100;

/** Styled to TWise's tables: navy header, white text, light borders. */
export const BI_GRID_THEME = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  accentColor: '#21409A',
  headerBackgroundColor: '#21409A',
  headerTextColor: '#FFFFFF',
  headerFontWeight: 600,
  borderColor: '#DCE3ED',
  rowHoverColor: '#F5F8FF',
  oddRowBackgroundColor: '#FAFBFD',
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
    />
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .grid { display: block; width: 100%; height: 100%; }
  `,
})
export class RowsGridComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  readonly request = input.required<RowsRequest | null>();
  readonly columns = input.required<GridColumn[]>();
  readonly total = output<number>();
  readonly failed = output<string>();

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
  }
}

import { Routes } from '@angular/router';

/**
 * Mount under any path in the host, e.g.
 * { path: 'bi', loadChildren: () => import('@tasnim/bi').then((m) => m.BI_ROUTES) }.
 * Every page is lazy-loaded, so Highcharts and AG Grid load only when a report opens.
 */
export const BI_ROUTES: Routes = [
  { path: '', title: 'Reports', loadComponent: () => import('@tasnim/bi/report').then((m) => m.ReportListComponent) },
  { path: 'data-sources', title: 'Data sources', loadComponent: () => import('@tasnim/bi/admin').then((m) => m.DataSourcesComponent) },
  { path: 'json-import', title: 'JSON import', loadComponent: () => import('@tasnim/bi/admin').then((m) => m.JsonImportComponent) },
  { path: 'measures', title: 'Measures', loadComponent: () => import('@tasnim/bi/admin').then((m) => m.MeasureEditorComponent) },
  { path: ':reportId', title: 'Report', loadComponent: () => import('@tasnim/bi/report').then((m) => m.ReportComponent) },
];

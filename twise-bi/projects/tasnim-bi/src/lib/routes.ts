import { Routes } from '@angular/router';

/**
 * Mount under any path in the host, e.g.
 * { path: 'bi', loadChildren: () => import('@tasnim/bi').then((m) => m.BI_ROUTES) }.
 * Every page is lazy-loaded, so Highcharts and AG Grid load only when a report opens.
 */
export const BI_ROUTES: Routes = [
  { path: '', title: 'Reports', loadComponent: () => import('./report/report-list.component').then((m) => m.ReportListComponent) },
  { path: 'data-sources', title: 'Data sources', loadComponent: () => import('./admin/data-sources.component').then((m) => m.DataSourcesComponent) },
  { path: 'json-import', title: 'JSON import', loadComponent: () => import('./admin/json-import.component').then((m) => m.JsonImportComponent) },
  { path: 'measures', title: 'Measures', loadComponent: () => import('./admin/measure-editor.component').then((m) => m.MeasureEditorComponent) },
  { path: ':reportId', title: 'Report', loadComponent: () => import('./report/report.component').then((m) => m.ReportComponent) },
];

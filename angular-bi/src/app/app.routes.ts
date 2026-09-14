import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'data-sources' },
  {
    path: 'data-sources',
    loadComponent: () => import('./features/data-sources/data-sources.component').then((m) => m.DataSourcesComponent),
  },
  {
    path: 'json-explorer',
    loadComponent: () => import('./features/json-explorer/json-explorer.component').then((m) => m.JsonExplorerComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'query-builder',
    loadComponent: () => import('./features/query-builder/query-builder.component').then((m) => m.QueryBuilderComponent),
  },
  { path: '**', redirectTo: 'data-sources' },
];

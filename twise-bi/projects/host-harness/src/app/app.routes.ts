import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'reports' },
  { path: 'home', title: 'Dashboard', loadComponent: () => import('./pages/host-home.page').then((m) => m.HostHomePage) },
  // The one line TWise adds to mount every BI page.
  { path: 'reports', loadChildren: () => import('@tasnim/bi').then((m) => m.BI_ROUTES) },
  { path: 'embedded', title: 'Chart details', loadComponent: () => import('./pages/embedded-report.page').then((m) => m.EmbeddedReportPage) },
  { path: '**', redirectTo: 'reports' },
];

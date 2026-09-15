import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideBi, provideBiVisual } from '@tasnim/bi';
import { routes } from './app.routes';
import { KPI_PROGRESS_VISUAL } from './twise/kpi-progress.visual';
import { TwiseFilterBridge } from './twise/twise-filter-bridge';

/**
 * Everything TWise has to add to use the BI module: provideBi() with its API
 * base URL and filter bridge, plus any custom visuals. HttpClient and the
 * router already exist in TWise.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideBi({
      apiBaseUrl: isDevMode() ? 'http://localhost:4173/api/bi' : '/api/bi',
      filterBridge: TwiseFilterBridge,
    }),
    provideBiVisual(KPI_PROGRESS_VISUAL),
  ],
};

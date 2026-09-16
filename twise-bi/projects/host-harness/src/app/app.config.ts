import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideBi, provideBiVisual } from '@tasnim/bi';
import { routes } from './app.routes';
import { KPI_PROGRESS_VISUAL } from './twise/kpi-progress.visual';

/** The demo's signed-in person. TWise takes this from its session instead. */
const DEMO_USER_ID = 'demo-author';

/**
 * Everything TWise has to add to use the BI module: provideBi() with its API
 * base URL, plus any custom visuals. HttpClient and the router already exist
 * in TWise.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideBi({
      apiBaseUrl: isDevMode() ? 'http://localhost:4173/api/bi' : '/api/bi',
      // Favorites and recent reports per person, on the local stand-in for TWise's user service (preferences-server).
      preferences: isDevMode() ? { url: 'http://localhost:4175', userId: () => DEMO_USER_ID } : undefined,
    }),
    provideBiVisual(KPI_PROGRESS_VISUAL),
  ],
};

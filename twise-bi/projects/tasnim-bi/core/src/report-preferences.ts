import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, of } from 'rxjs';

export interface RecentReport {
  reportId: number;
  openedAt: string;
}

export interface ReportPreferencesState {
  /** Report ids, most recently starred first. */
  favorites: number[];
  /** Most recently opened first. */
  recent: RecentReport[];
}

/**
 * Favorite and recently opened reports for the person using the app (R3).
 * The default keeps them in the browser; HttpReportPreferences keeps them on a
 * per-user service; TWise can provide its own implementation of this interface.
 */
export interface ReportPreferences {
  load(): Observable<ReportPreferencesState>;
  setFavorite(reportId: number, favorite: boolean): Observable<ReportPreferencesState>;
  recordOpened(reportId: number): Observable<ReportPreferencesState>;
}

export const MAX_RECENT_REPORTS = 10;
const EMPTY: ReportPreferencesState = { favorites: [], recent: [] };

export function withFavorite(state: ReportPreferencesState, reportId: number, favorite: boolean): ReportPreferencesState {
  const favorites = state.favorites.filter((id) => id !== reportId);
  return { ...state, favorites: favorite ? [reportId, ...favorites] : favorites };
}

export function withOpened(state: ReportPreferencesState, reportId: number, openedAt: string): ReportPreferencesState {
  const recent = [{ reportId, openedAt }, ...state.recent.filter((r) => r.reportId !== reportId)].slice(0, MAX_RECENT_REPORTS);
  return { ...state, recent };
}

const PREFERENCES_KEY = 'tasnim-bi.report-preferences';

/** Per-browser preferences (option 1): works with no user service at all. */
@Injectable()
export class LocalReportPreferences implements ReportPreferences {
  private read(): ReportPreferencesState {
    try {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<ReportPreferencesState> | null;
      return {
        favorites: Array.isArray(stored?.favorites) ? stored.favorites.filter(Number.isInteger) : [],
        recent: Array.isArray(stored?.recent) ? stored.recent.filter((r) => Number.isInteger(r?.reportId) && typeof r?.openedAt === 'string') : [],
      };
    } catch {
      return EMPTY;
    }
  }

  private write(state: ReportPreferencesState): ReportPreferencesState {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state));
    } catch {
      // Storage blocked: preferences last for this page only.
    }
    return state;
  }

  load() {
    return of(this.read());
  }

  setFavorite(reportId: number, favorite: boolean) {
    return of(this.write(withFavorite(this.read(), reportId, favorite)));
  }

  recordOpened(reportId: number) {
    return of(this.write(withOpened(this.read(), reportId, new Date().toISOString())));
  }
}

/** Where a per-user preferences service lives, and who the current person is. */
export interface PreferencesApi {
  url: string;
  /** The demo sends this as X-User-Id; a host with sign-in can send its token through an HttpClient interceptor instead. */
  userId: () => string;
}

export const BI_PREFERENCES_API = new InjectionToken<PreferencesApi>('BI_PREFERENCES_API');

/** Per-user preferences on a server (option 2): the local preferences-server in the demo, TWise's user API in production. */
@Injectable()
export class HttpReportPreferences implements ReportPreferences {
  private readonly http = inject(HttpClient);
  private readonly api = inject(BI_PREFERENCES_API);
  private readonly base = `${this.api.url.replace(/\/+$/, '')}/api/users/me`;

  private headers(): HttpHeaders {
    return new HttpHeaders({ 'X-User-Id': this.api.userId() });
  }

  load() {
    return this.http.get<ReportPreferencesState>(`${this.base}/report-preferences`, { headers: this.headers() });
  }

  setFavorite(reportId: number, favorite: boolean) {
    return this.http.put<ReportPreferencesState>(`${this.base}/report-favorites/${reportId}`, { favorite }, { headers: this.headers() });
  }

  recordOpened(reportId: number) {
    return this.http.post<ReportPreferencesState>(`${this.base}/report-recent`, { reportId }, { headers: this.headers() });
  }
}

export const BI_REPORT_PREFERENCES = new InjectionToken<ReportPreferences>('BI_REPORT_PREFERENCES', {
  providedIn: 'root',
  factory: () => new LocalReportPreferences(),
});

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  QueryConfig,
  QueryResult,
  RawEvent,
  SavedMeasure,
  SourceInfo,
} from './models';

/**
 * Thin, typed client over the local BFF (query-builder-prototype/server.js).
 * Every call here maps 1:1 to a validated backend route — this service does
 * no ad-hoc SQL building; the metadata-validation gate lives server-side.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  getSources(): Observable<SourceInfo> {
    return this.http.get<SourceInfo>(`${this.base}/sources`);
  }

  getTablePreview(table: string): Observable<{ rows: Record<string, unknown>[] }> {
    return this.http.get<{ rows: Record<string, unknown>[] }>(`${this.base}/tables/${encodeURIComponent(table)}/preview`);
  }

  getTableSchema(table: string): Observable<{ table: string; columns: { name: string; type: string }[] }> {
    return this.http.get<{ table: string; columns: { name: string; type: string }[] }>(
      `${this.base}/tables/${encodeURIComponent(table)}/schema`,
    );
  }

  runQuery(config: QueryConfig): Observable<QueryResult> {
    return this.http.post<QueryResult>(`${this.base}/query`, config);
  }

  getMeasures(): Observable<{ measures: SavedMeasure[] }> {
    return this.http.get<{ measures: SavedMeasure[] }>(`${this.base}/measures`);
  }

  saveMeasure(name: string, config: QueryConfig): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/measures`, { name, config });
  }

  deleteMeasure(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/measures/${id}`);
  }

  getRawEvents(): Observable<{ events: RawEvent[] }> {
    return this.http.get<{ events: RawEvent[] }>(`${this.base}/raw-events`);
  }
}

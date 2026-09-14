import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ChartType,
  ColumnInfo,
  ConnectionInfo,
  DashboardChart,
  DashboardInfo,
  IngestResult,
  QueryConfig,
  QueryResult,
  RawEvent,
  SavedMeasure,
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

  // Connections
  getConnections(): Observable<{ connections: ConnectionInfo[] }> {
    return this.http.get<{ connections: ConnectionInfo[] }>(`${this.base}/connections`);
  }

  getAvailableFiles(): Observable<{ files: string[] }> {
    return this.http.get<{ files: string[] }>(`${this.base}/connections/available-files`);
  }

  addConnection(name: string, fileName: string, secret?: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/connections`, { name, fileName, secret });
  }

  deleteConnection(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/connections/${id}`);
  }

  getTablePreview(connectionId: number, table: string): Observable<{ rows: Record<string, unknown>[] }> {
    return this.http.get<{ rows: Record<string, unknown>[] }>(`${this.base}/connections/${connectionId}/tables/${encodeURIComponent(table)}/preview`);
  }

  getTableSchema(connectionId: number, table: string): Observable<{ table: string; columns: ColumnInfo[] }> {
    return this.http.get<{ table: string; columns: ColumnInfo[] }>(`${this.base}/connections/${connectionId}/tables/${encodeURIComponent(table)}/schema`);
  }

  // Query engine
  runQuery(config: QueryConfig): Observable<QueryResult> {
    return this.http.post<QueryResult>(`${this.base}/query`, config);
  }

  drilldown(payload: {
    connectionId: number;
    table: string;
    groupBy?: string | null;
    groupValue?: string | number;
    filters: { field: string; op: string; value: string }[];
  }): Observable<{ sql: string; params: unknown[]; rows: Record<string, unknown>[] }> {
    return this.http.post<{ sql: string; params: unknown[]; rows: Record<string, unknown>[] }>(`${this.base}/drilldown`, payload);
  }

  // Measures
  getMeasures(): Observable<{ measures: SavedMeasure[] }> {
    return this.http.get<{ measures: SavedMeasure[] }>(`${this.base}/measures`);
  }

  saveMeasure(name: string, config: QueryConfig): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/measures`, { name, config });
  }

  deleteMeasure(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/measures/${id}`);
  }

  // JSON Explorer
  getRawEvents(): Observable<{ events: RawEvent[] }> {
    return this.http.get<{ events: RawEvent[] }>(`${this.base}/raw-events`);
  }

  ingest(connectionId: number, tableName: string, rows: Record<string, unknown>[]): Observable<IngestResult> {
    return this.http.post<IngestResult>(`${this.base}/ingest`, { connectionId, tableName, rows });
  }

  // Dashboards
  getDashboards(): Observable<{ dashboards: DashboardInfo[] }> {
    return this.http.get<{ dashboards: DashboardInfo[] }>(`${this.base}/dashboards`);
  }

  addDashboard(name: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/dashboards`, { name });
  }

  renameDashboard(id: number, name: string): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${this.base}/dashboards/${id}`, { name });
  }

  deleteDashboard(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/dashboards/${id}`);
  }

  getDashboardCharts(dashboardId: number): Observable<{ charts: DashboardChart[] }> {
    return this.http.get<{ charts: DashboardChart[] }>(`${this.base}/dashboards/${dashboardId}/charts`);
  }

  addDashboardChart(dashboardId: number, title: string, chartType: string, config: QueryConfig): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/dashboards/${dashboardId}/charts`, { title, chartType, config });
  }

  updateDashboardChart(
    dashboardId: number,
    chartId: number,
    patch: Partial<{ title: string; chartType: ChartType; config: QueryConfig }>,
  ): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${this.base}/dashboards/${dashboardId}/charts/${chartId}`, patch);
  }

  deleteDashboardChart(dashboardId: number, chartId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/dashboards/${dashboardId}/charts/${chartId}`);
  }
}

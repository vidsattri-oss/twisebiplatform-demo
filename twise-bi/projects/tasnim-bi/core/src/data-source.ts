import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  BiFilter,
  IngestRequest,
  IngestResult,
  Measure,
  MeasureInput,
  MeasureValidateResult,
  ModelSummary,
  QueryResult,
  Report,
  ReportInput,
  ReportSummary,
  RowsRequest,
  RowsResult,
  SemanticModel,
  ValuesRequest,
  ValuesResult,
  VisualQuery,
} from './contract';

/**
 * Everything the library needs from a backend. The default implementation
 * speaks the /api/bi contract over HttpClient; a host can provide its own
 * (for example one that goes through TWise's existing API services).
 * Observables must cancel their request on unsubscribe (invariant I7).
 */
export interface BiDataSource {
  listModels(): Observable<ModelSummary[]>;
  getModel(modelId: number): Observable<SemanticModel>;
  query(query: VisualQuery): Observable<QueryResult>;
  rows(request: RowsRequest): Observable<RowsResult>;
  values(request: ValuesRequest): Observable<ValuesResult>;
  validateMeasure(modelId: number, table: string, expression: string): Observable<MeasureValidateResult>;
  createMeasure(modelId: number, measure: MeasureInput): Observable<Measure>;
  deleteMeasure(modelId: number, measureId: number): Observable<unknown>;
  listReports(): Observable<ReportSummary[]>;
  getReport(reportId: number): Observable<Report>;
  createReport(report: ReportInput): Observable<Report>;
  updateReport(reportId: number, report: ReportInput): Observable<Report>;
  deleteReport(reportId: number): Observable<unknown>;
  availableFiles(): Observable<string[]>;
  addConnection(name: string, fileName: string): Observable<{ id: number }>;
  removeConnection(connectionId: number): Observable<unknown>;
  ingestJson(request: IngestRequest): Observable<IngestResult>;
  saveDatasetFilters(modelId: number, filters: BiFilter[]): Observable<BiFilter[]>;
}

export const BI_DATA_SOURCE = new InjectionToken<BiDataSource>('BI_DATA_SOURCE');

/** Base URL of the /api/bi contract, e.g. "https://tenant-api.example/api/bi". */
export const BI_API_BASE_URL = new InjectionToken<string>('BI_API_BASE_URL', { factory: () => '/api/bi' });

@Injectable()
export class HttpBiDataSource implements BiDataSource {
  private readonly http = inject(HttpClient);
  private readonly base = inject(BI_API_BASE_URL).replace(/\/+$/, '');

  listModels() {
    return this.http.get<ModelSummary[]>(`${this.base}/models`);
  }
  getModel(modelId: number) {
    return this.http.get<SemanticModel>(`${this.base}/models/${modelId}`);
  }
  query(query: VisualQuery) {
    return this.http.post<QueryResult>(`${this.base}/query`, query);
  }
  rows(request: RowsRequest) {
    return this.http.post<RowsResult>(`${this.base}/rows`, request);
  }
  values(request: ValuesRequest) {
    return this.http.post<ValuesResult>(`${this.base}/values`, request);
  }
  validateMeasure(modelId: number, table: string, expression: string) {
    return this.http.post<MeasureValidateResult>(`${this.base}/measures/validate`, { modelId, table, expression });
  }
  createMeasure(modelId: number, measure: MeasureInput) {
    return this.http.post<Measure>(`${this.base}/models/${modelId}/measures`, measure);
  }
  deleteMeasure(modelId: number, measureId: number) {
    return this.http.delete(`${this.base}/models/${modelId}/measures/${measureId}`);
  }
  listReports() {
    return this.http.get<ReportSummary[]>(`${this.base}/reports`);
  }
  getReport(reportId: number) {
    return this.http.get<Report>(`${this.base}/reports/${reportId}`);
  }
  createReport(report: ReportInput) {
    return this.http.post<Report>(`${this.base}/reports`, report);
  }
  updateReport(reportId: number, report: ReportInput) {
    return this.http.put<Report>(`${this.base}/reports/${reportId}`, report);
  }
  deleteReport(reportId: number) {
    return this.http.delete(`${this.base}/reports/${reportId}`);
  }
  availableFiles() {
    return this.http.get<string[]>(`${this.base}/connections/available-files`);
  }
  addConnection(name: string, fileName: string) {
    return this.http.post<{ id: number }>(`${this.base}/connections`, { name, fileName });
  }
  removeConnection(connectionId: number) {
    return this.http.delete(`${this.base}/connections/${connectionId}`);
  }
  ingestJson(request: IngestRequest) {
    return this.http.post<IngestResult>(`${this.base}/ingest/json`, request);
  }
  saveDatasetFilters(modelId: number, filters: BiFilter[]) {
    return this.http.put<BiFilter[]>(`${this.base}/models/${modelId}/dataset-filters`, { filters });
  }
}

/** A message a person can act on, taken from the contract's { error } body when there is one. */
export function describeError(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return "Can't reach the BI service. Check that it's running, then try again.";
    const body = err.error as { error?: unknown } | null;
    if (body && typeof body.error === 'string') return body.error;
    return `${fallback} (HTTP ${err.status})`;
  }
  return err instanceof Error ? err.message : fallback;
}

/** Character offset of an expression error, when the backend reported one. */
export function errorPosition(err: unknown): number | undefined {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { position?: unknown } | null;
    return typeof body?.position === 'number' ? body.position : undefined;
  }
  return undefined;
}

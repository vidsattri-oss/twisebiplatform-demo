import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  BiFilter,
  CalculatedColumnInput,
  Column,
  ConnectionInput,
  ConnectionPatch,
  ConnectionTestResult,
  ConnectionTypeInfo,
  CsvUploadRequest,
  ExcelUploadRequest,
  ExcelUploadResult,
  RefreshResult,
  ReportCategory,
  ReportPatch,
  ExpressionKind,
  ExpressionPreview,
  IngestRequest,
  IngestResult,
  JsonColumnRequest,
  JsonColumnResult,
  PluginCatalogEntry,
  PluginPackage,
  PluginVisual,
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
  validateMeasure(modelId: number, table: string, expression: string, kind?: ExpressionKind): Observable<MeasureValidateResult>;
  previewExpression(modelId: number, table: string, expression: string, kind: ExpressionKind): Observable<ExpressionPreview>;
  createMeasure(modelId: number, measure: MeasureInput): Observable<Measure>;
  deleteMeasure(modelId: number, measureId: number): Observable<unknown>;
  createColumn(modelId: number, column: CalculatedColumnInput): Observable<Column>;
  deleteColumn(modelId: number, columnId: number): Observable<unknown>;
  listReports(): Observable<ReportSummary[]>;
  getReport(reportId: number): Observable<Report>;
  createReport(report: ReportInput): Observable<Report>;
  updateReport(reportId: number, report: ReportInput): Observable<Report>;
  deleteReport(reportId: number): Observable<unknown>;
  patchReport(reportId: number, patch: ReportPatch): Observable<Report>;
  duplicateReport(reportId: number): Observable<Report>;
  listCategories(): Observable<ReportCategory[]>;
  saveCategories(categories: ReportCategory[]): Observable<ReportCategory[]>;
  availableFiles(): Observable<string[]>;
  connectionTypes(): Observable<ConnectionTypeInfo[]>;
  addConnection(connection: ConnectionInput): Observable<{ id: number }>;
  updateConnection(connectionId: number, patch: ConnectionPatch): Observable<{ id: number }>;
  testConnection(connectionId: number): Observable<ConnectionTestResult>;
  refreshConnection(connectionId: number): Observable<RefreshResult>;
  removeConnection(connectionId: number): Observable<unknown>;
  uploadCsv(request: CsvUploadRequest): Observable<IngestResult>;
  uploadExcel(request: ExcelUploadRequest): Observable<ExcelUploadResult>;
  ingestJson(request: IngestRequest): Observable<IngestResult>;
  flattenJsonColumn(request: JsonColumnRequest): Observable<JsonColumnResult>;
  saveDatasetFilters(modelId: number, filters: BiFilter[]): Observable<BiFilter[]>;
  listPlugins(): Observable<PluginVisual[]>;
  pluginCatalog(): Observable<PluginCatalogEntry[]>;
  catalogPlugin(type: string): Observable<PluginPackage>;
  installCatalogPlugin(type: string): Observable<PluginVisual>;
  importPlugin(plugin: PluginPackage): Observable<PluginVisual>;
  removePlugin(type: string): Observable<unknown>;
  /** The plug-in's JavaScript as text, to run only inside the sandboxed frame. */
  pluginCode(type: string): Observable<string>;
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
  validateMeasure(modelId: number, table: string, expression: string, kind: ExpressionKind = 'measure') {
    return this.http.post<MeasureValidateResult>(`${this.base}/measures/validate`, { modelId, table, expression, kind });
  }
  previewExpression(modelId: number, table: string, expression: string, kind: ExpressionKind) {
    return this.http.post<ExpressionPreview>(`${this.base}/measures/preview`, { modelId, table, expression, kind });
  }
  createMeasure(modelId: number, measure: MeasureInput) {
    return this.http.post<Measure>(`${this.base}/models/${modelId}/measures`, measure);
  }
  deleteMeasure(modelId: number, measureId: number) {
    return this.http.delete(`${this.base}/models/${modelId}/measures/${measureId}`);
  }
  createColumn(modelId: number, column: CalculatedColumnInput) {
    return this.http.post<Column>(`${this.base}/models/${modelId}/columns`, column);
  }
  deleteColumn(modelId: number, columnId: number) {
    return this.http.delete(`${this.base}/models/${modelId}/columns/${columnId}`);
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
  patchReport(reportId: number, patch: ReportPatch) {
    return this.http.patch<Report>(`${this.base}/reports/${reportId}`, patch);
  }
  duplicateReport(reportId: number) {
    return this.http.post<Report>(`${this.base}/reports/${reportId}/duplicate`, {});
  }
  listCategories() {
    return this.http.get<ReportCategory[]>(`${this.base}/report-categories`);
  }
  saveCategories(categories: ReportCategory[]) {
    return this.http.put<ReportCategory[]>(`${this.base}/report-categories`, { categories });
  }
  availableFiles() {
    return this.http.get<string[]>(`${this.base}/connections/available-files`);
  }
  connectionTypes() {
    return this.http.get<ConnectionTypeInfo[]>(`${this.base}/connections/types`);
  }
  addConnection(connection: ConnectionInput) {
    return this.http.post<{ id: number }>(`${this.base}/connections`, connection);
  }
  updateConnection(connectionId: number, patch: ConnectionPatch) {
    return this.http.put<{ id: number }>(`${this.base}/connections/${connectionId}`, patch);
  }
  testConnection(connectionId: number) {
    return this.http.post<ConnectionTestResult>(`${this.base}/connections/${connectionId}/test`, {});
  }
  refreshConnection(connectionId: number) {
    return this.http.post<RefreshResult>(`${this.base}/connections/${connectionId}/refresh`, {});
  }
  removeConnection(connectionId: number) {
    return this.http.delete(`${this.base}/connections/${connectionId}`);
  }
  uploadCsv(request: CsvUploadRequest) {
    return this.http.post<IngestResult>(`${this.base}/ingest/csv`, request);
  }
  uploadExcel(request: ExcelUploadRequest) {
    return this.http.post<ExcelUploadResult>(`${this.base}/ingest/excel`, request);
  }
  ingestJson(request: IngestRequest) {
    return this.http.post<IngestResult>(`${this.base}/ingest/json`, request);
  }
  flattenJsonColumn(request: JsonColumnRequest) {
    return this.http.post<JsonColumnResult>(`${this.base}/ingest/json-column`, request);
  }
  saveDatasetFilters(modelId: number, filters: BiFilter[]) {
    return this.http.put<BiFilter[]>(`${this.base}/models/${modelId}/dataset-filters`, { filters });
  }
  listPlugins() {
    return this.http.get<PluginVisual[]>(`${this.base}/visuals`);
  }
  pluginCatalog() {
    return this.http.get<PluginCatalogEntry[]>(`${this.base}/visuals/catalog`);
  }
  catalogPlugin(type: string) {
    return this.http.get<PluginPackage>(`${this.base}/visuals/catalog/${encodeURIComponent(type)}`);
  }
  installCatalogPlugin(type: string) {
    return this.http.post<PluginVisual>(`${this.base}/visuals/catalog/${encodeURIComponent(type)}/install`, {});
  }
  importPlugin(plugin: PluginPackage) {
    return this.http.post<PluginVisual>(`${this.base}/visuals`, plugin);
  }
  removePlugin(type: string) {
    return this.http.delete(`${this.base}/visuals/${encodeURIComponent(type)}`);
  }
  pluginCode(type: string) {
    return this.http.get<{ code: string }>(`${this.base}/visuals/${encodeURIComponent(type)}/code`).pipe(map((r) => r.code));
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

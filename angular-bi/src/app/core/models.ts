export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  rowCount: number;
}

export interface ConnectionInfo {
  id: number;
  name: string;
  fileName: string;
  driver: string;
  status: 'connected' | 'error';
  createdAt: string;
  tables: TableInfo[];
  error: string | null;
}

export type AggFn = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface QueryFilter {
  field: string;
  op: FilterOp;
  value: string;
}

export type Metric =
  | { type: 'agg'; agg: AggFn; field: string }
  | { type: 'ratio'; agg: AggFn; numerator: string; denominator: string };

export interface QueryJoin {
  connectionId: number;
  table: string;
  leftField: string;
  rightField: string;
}

export interface QueryConfig {
  connectionId: number;
  table: string;
  groupBy: string | null;
  filters: QueryFilter[];
  metric: Metric;
  join?: QueryJoin | null;
}

export interface QueryResultRow {
  group_key?: string | number;
  value: number | null;
}

export interface QueryResult {
  sql: string;
  params: unknown[];
  rows: QueryResultRow[];
}

export interface SavedMeasure {
  id: number;
  name: string;
  createdAt: string;
  config: QueryConfig;
}

export interface RawEvent {
  id: number;
  source: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

/** One flattened row: dotted/bracketed path -> scalar leaf value. */
export type FlatRow = Record<string, string | number | boolean | null>;

export interface IngestResult {
  connectionId: number;
  table: string;
  rowCount: number;
  columns: string[];
}

export interface DashboardInfo {
  id: number;
  name: string;
  createdAt: string;
}

export type ChartType = 'bar' | 'line' | 'pie';

export interface DashboardChart {
  id: number;
  title: string;
  chartType: ChartType;
  config: QueryConfig;
  position: number;
}

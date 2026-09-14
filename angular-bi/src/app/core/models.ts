export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
}

export interface SourceInfo {
  name: string;
  driver: string;
  file: string;
  status: 'connected' | 'error';
  lastSynced: string;
  tables: TableInfo[];
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

export interface QueryConfig {
  table: string;
  groupBy: string | null;
  filters: QueryFilter[];
  metric: Metric;
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

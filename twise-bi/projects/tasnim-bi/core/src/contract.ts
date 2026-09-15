/**
 * TypeScript mirror of docs/api/bi-contract.openapi.yaml — the only shape the
 * library and any backend (Node reference, TWise .NET tenant API) agree on.
 */

export type DataType = 'text' | 'integer' | 'number' | 'date' | 'datetime' | 'boolean';
export type Scalar = string | number | boolean | null;

export interface ModelSummary {
  id: number;
  name: string;
  fileName: string;
  driver?: string;
  status: 'connected' | 'error';
  tableCount: number;
  error?: string | null;
}

export interface Column {
  name: string;
  dataType: DataType;
  hidden?: boolean;
  sortBy?: string;
  format?: string;
  /** Present on calculated columns: the row-level formula that produces the value. */
  expression?: string;
  id?: number | null;
  /** Calculated columns: defined in the model file or created by a user. */
  origin?: 'model' | 'user';
  /** A calculated column whose formula no longer compiles. */
  expressionError?: string;
}

export interface Table {
  name: string;
  rowCount: number;
  hidden?: boolean;
  columns: Column[];
}

/** Many-to-one; filters flow from toTable (the "one" side) to fromTable. */
export interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  source?: 'foreignKey' | 'overlay';
}

export interface Measure {
  id?: number | null;
  name: string;
  table: string;
  expression: string;
  format?: string;
  origin: 'model' | 'user';
}

export interface SemanticModel {
  id: number;
  name: string;
  tables: Table[];
  relationships: Relationship[];
  measures: Measure[];
  /** Data-source level filters the server applies to every query on this model (I10). */
  datasetFilters?: BiFilter[];
}

export interface FieldRef {
  table: string;
  column: string;
}

export type DateLevel = 'year' | 'quarter' | 'month';

export interface GroupField extends FieldRef {
  dateLevel?: DateLevel;
}

export type FilterScope = 'report' | 'page' | 'visual';

interface FilterBase {
  id?: string;
  target: FieldRef;
  scope?: FilterScope;
}

export interface BasicFilter extends FilterBase {
  kind: 'basic';
  operator: 'in' | 'notIn';
  /** null means (Blank). */
  values: Scalar[];
}

export type AdvancedOperator =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'notContains' | 'startsWith' | 'isBlank' | 'isNotBlank';

export interface AdvancedCondition {
  operator: AdvancedOperator;
  value?: Scalar;
}

export interface AdvancedFilter extends FilterBase {
  kind: 'advanced';
  logic: 'and' | 'or';
  conditions: AdvancedCondition[];
}

export interface RangeFilter extends FilterBase {
  kind: 'range';
  min?: Scalar;
  max?: Scalar;
}

export type RelativeDateUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface RelativeDateFilter extends FilterBase {
  kind: 'relativeDate';
  period: 'last' | 'this' | 'next';
  count: number;
  unit: RelativeDateUnit;
  /** Default true. "Last 1 day" without today is Yesterday. */
  includeToday?: boolean;
}

export interface RelativeTimeFilter extends FilterBase {
  kind: 'relativeTime';
  period: 'last' | 'next';
  count: number;
  unit: 'minute' | 'hour';
}

export interface TopNFilter extends FilterBase {
  kind: 'topN';
  n: number;
  by: string;
  direction: 'top' | 'bottom';
}

export type BiFilter = BasicFilter | AdvancedFilter | RangeFilter | RelativeDateFilter | RelativeTimeFilter | TopNFilter;

export interface VisualQuery {
  modelId: number;
  groupBy: GroupField[];
  measures: string[];
  filters: BiFilter[];
  highlight?: BiFilter[];
  orderBy?: { by: 'category' | 'measure'; index?: number; direction?: 'asc' | 'desc' };
  limit?: number;
  asOf?: string;
}

export interface QueryColumn {
  name: string;
  role: 'group' | 'measure';
  dataType: DataType;
  format?: string;
}

export interface QueryRow {
  keys: Scalar[];
  /** Text measures (KPI labels) return strings; true/false measures return booleans. */
  values: Scalar[];
  highlights: (number | null)[] | null;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: QueryRow[];
  truncated: boolean;
  ignoredFilters: number[];
  ignoredHighlight?: number[];
}

export interface RowsRequest {
  modelId: number;
  table?: string;
  columns?: FieldRef[];
  filters: BiFilter[];
  offset?: number;
  limit?: number;
  asOf?: string;
}

export interface RowsResult {
  columns: { table: string; name: string; dataType: DataType }[];
  rows: Scalar[][];
  total: number;
  ignoredFilters: number[];
}

export interface ValuesRequest {
  modelId: number;
  target: FieldRef;
  filters: BiFilter[];
  search?: string;
  limit?: number;
  asOf?: string;
}

export interface ValuesResult {
  values: Scalar[];
  truncated: boolean;
  min?: Scalar;
  max?: Scalar;
  ignoredFilters?: number[];
}

export interface MeasureRoleItem {
  measure: string;
}

export type RoleItem = GroupField | MeasureRoleItem;

export type VisualInteraction = 'filter' | 'highlight' | 'none';

export interface VisualLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisualDefinition {
  id: string;
  type: string;
  title?: string;
  roles: Record<string, RoleItem[]>;
  filters: BiFilter[];
  /** Target visual id → how this visual's selection affects it. */
  interactions?: Record<string, VisualInteraction>;
  options?: Record<string, unknown>;
  layout?: VisualLayout;
}

export interface PageDefinition {
  id: string;
  name: string;
  filters: BiFilter[];
  visuals: VisualDefinition[];
}

export interface ReportSettings {
  /** Power BI's "Multi-select without using Ctrl": every click adds to the selection. */
  multiSelectWithoutCtrl?: boolean;
}

export interface ReportDefinition {
  filters: BiFilter[];
  pages: PageDefinition[];
  settings?: ReportSettings;
}

export interface ReportInput {
  name: string;
  modelId: number;
  definition: ReportDefinition;
}

export interface Report extends ReportInput {
  id: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReportSummary {
  id: number;
  name: string;
  modelId: number;
  updatedAt?: string;
}

export interface MeasureInput {
  table: string;
  name: string;
  expression: string;
  format?: string;
}

/** A measure aggregates rows; a calculated column is evaluated for each row. */
export type ExpressionKind = 'measure' | 'column';

export interface CalculatedColumnInput {
  table: string;
  name: string;
  expression: string;
  format?: string;
}

export interface ExpressionPreview {
  dataType: DataType;
  /** Measures: the value over the whole home table, dataset filters applied. */
  value?: Scalar;
  /** Calculated columns: the first rows, with the result as the last column. */
  sample?: { columns: string[]; rows: Scalar[][] };
}

export interface BiApiError {
  error: string;
  position?: number;
}

export interface MeasureValidateResult {
  ok: boolean;
  /** What the formula returns: number, text, true/false or a date. */
  dataType?: DataType;
  dependencies?: string[];
  error?: BiApiError;
}

export interface IngestRequest {
  connectionId?: number;
  tableName: string;
  records: Record<string, unknown> | Record<string, unknown>[];
  mode?: 'append' | 'replace';
  dryRun?: boolean;
}

export interface IngestTable {
  name: string;
  parent: string | null;
  rowCount: number;
  columns: { name: string; dataType: DataType }[];
  addedColumns: string[];
  sample: Record<string, Scalar>[];
}

export interface IngestResult {
  connectionId: number;
  written: boolean;
  tables: IngestTable[];
}

/** Flatten a JSON text column (e.g. task_daily.daily_data) into tables linked to each source row. */
export interface JsonColumnRequest {
  connectionId: number;
  table: string;
  column: string;
  /** Identifies each source row (usually id); flattened rows reference it. */
  keyColumn: string;
  /** Key paths to extract, e.g. "employee_ids", "metrics.actual_hours". Omit for every key. */
  keys?: string[];
  mode?: 'append' | 'replace';
  dryRun?: boolean;
}

export interface JsonColumnResult extends IngestResult {
  sourceRows: number;
  /** Rows with no JSON object, or none of the chosen keys. */
  skipped: number;
  availableKeys: string[];
  missingKeys: string[];
}

export function isMeasureItem(item: RoleItem): item is MeasureRoleItem {
  return typeof (item as MeasureRoleItem).measure === 'string';
}

export function fieldRef(field: FieldRef): FieldRef {
  return { table: field.table, column: field.column };
}

export function sameField(a: FieldRef, b: FieldRef): boolean {
  return a.table === b.table && a.column === b.column && (a as GroupField).dateLevel === (b as GroupField).dateLevel;
}

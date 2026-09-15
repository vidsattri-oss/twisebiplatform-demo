'use strict';

/**
 * Compiles contract requests (VisualQuery, RowsRequest, ValuesRequest) into SQL.
 *
 * - I1: tables and columns are resolved from the model; only quoteIdent'd model
 *   names reach SQL text.
 * - I2: every filter value is coerced to the column's dataType and bound as a
 *   named parameter. Named parameters let the highlight predicate repeat inside
 *   several aggregates and stay bound.
 * - Joins follow many-to-one relationships outward from the base table (Power BI
 *   single-direction cross-filtering). A filter on a table the base can't reach
 *   is skipped and reported in ignoredFilters, not silently dropped.
 */

const { badRequest } = require('./errors');
const { quoteIdent, findTable, findColumn, findMeasure } = require('./model');
const { compileExpression } = require('./dax');

const LIMITS = { groups: 5000, rows: 1000, defaultRows: 100, values: 500, defaultValues: 200, filters: 200, inValues: 1000 };

class Params {
  constructor() {
    this.values = {};
    this.count = 0;
  }
  add(value) {
    const key = `p${this.count++}`;
    this.values[key] = value;
    return `$${key}`;
  }
  /** Only the parameters a statement actually uses; node:sqlite rejects unknown names. */
  for(sql) {
    const used = {};
    for (const m of sql.matchAll(/\$(p\d+)\b/g)) used[m[1]] = this.values[m[1]];
    return used;
  }
}

/** Breadth-first join plan over many-to-one relationships, starting at the base table. */
function createPlan(model, baseTable) {
  findTable(model, baseTable);
  const nodes = new Map([[baseTable, { alias: 't0', parent: null, rel: null }]]);
  const queue = [baseTable];
  while (queue.length) {
    const current = queue.shift();
    for (const rel of model.relationships) {
      if (rel.fromTable !== current || nodes.has(rel.toTable)) continue;
      nodes.set(rel.toTable, { alias: `t${nodes.size}`, parent: current, rel });
      queue.push(rel.toTable);
    }
  }
  const used = new Set([baseTable]);
  return {
    base: baseTable,
    reaches: (table) => nodes.has(table),
    alias(table) {
      if (!nodes.has(table)) throw new Error(`internal: "${table}" is not reachable from "${baseTable}"`);
      for (let t = table; t && !used.has(t); t = nodes.get(t).parent) used.add(t);
      return nodes.get(table).alias;
    },
    /** Call after every alias() so all needed joins are included. */
    fromSql() {
      const parts = [`FROM ${quoteIdent(baseTable)} AS t0`];
      for (const [table, node] of nodes) {
        if (table === baseTable || !used.has(table)) continue;
        const parent = nodes.get(node.parent).alias;
        parts.push(`LEFT JOIN ${quoteIdent(table)} AS ${node.alias} ON ${node.alias}.${quoteIdent(node.rel.toColumn)} = ${parent}.${quoteIdent(node.rel.fromColumn)}`);
      }
      return parts.join(' ');
    },
  };
}

function coerce(col, value, where) {
  if (value === null) return null;
  switch (col.dataType) {
    case 'integer':
      if (Number.isInteger(value)) return value;
      if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
      break;
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      break;
    case 'date':
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) return value;
      break;
    case 'datetime': {
      // Stored and compared as "YYYY-MM-DD HH:MM:SS" (UTC); accepts the ISO "T" form and a bare date.
      const m = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?Z?)?$/.exec(value);
      if (m && !Number.isNaN(Date.parse(m[1]))) return `${m[1]} ${m[2] ?? '00:00'}:${m[3] ?? '00'}`;
      break;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (value === 0 || value === 1) return value;
      break;
    default:
      if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  }
  const hint = col.dataType === 'date' ? ' (use YYYY-MM-DD)' : col.dataType === 'datetime' ? ' (use YYYY-MM-DD HH:MM:SS)' : '';
  throw badRequest(`${where}: ${JSON.stringify(value)} isn't a valid ${col.dataType}${hint}.`);
}

const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoDateTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const DAY_MS = 86400000;

/**
 * "Now" for relative date and time filters. asOf may be a date ("2026-09-14",
 * today at the current UTC time of day) or a UTC date-time ("2026-09-14T12:00:00"),
 * so tests and saved "as of" views are deterministic.
 */
function resolveClock(asOf) {
  if (asOf === undefined || asOf === null) {
    const now = Date.now();
    return { asOf: isoDay(now), now };
  }
  const m = typeof asOf === 'string' && /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?))?$/.exec(asOf);
  if (!m || Number.isNaN(Date.parse(m[1]))) throw badRequest('asOf must be a date like 2026-09-14 or a UTC date-time like 2026-09-14T12:00:00.');
  const now = m[2] ? Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}Z`) : Date.parse(`${m[1]}T00:00:00Z`) + (Date.now() % DAY_MS);
  return { asOf: m[1], now };
}

/**
 * Power BI relative dates. "last N units" ends today, or yesterday when
 * includeToday is false (so "last 1 day" without today = Yesterday); "next N
 * units" starts today or tomorrow; "this unit" is the calendar day, ISO week
 * (Monday–Sunday), month, quarter or year.
 */
function relativeRange(f, asOf) {
  if (!['last', 'this', 'next'].includes(f.period)) throw badRequest('Relative date period must be last, this or next.');
  if (!['day', 'week', 'month', 'quarter', 'year'].includes(f.unit)) throw badRequest('Relative date unit must be day, week, month, quarter or year.');
  if (f.includeToday !== undefined && typeof f.includeToday !== 'boolean') throw badRequest('includeToday must be true or false.');
  const includeToday = f.includeToday !== false;
  const count = f.period === 'this' ? 1 : f.count;
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw badRequest('Relative date count must be a whole number from 1 to 1000.');

  const [y, m, d] = asOf.split('-').map(Number);
  const today = Date.UTC(y, m - 1, d);
  const DAY = 86400000;
  const add = (ms, unit, k) => {
    if (unit === 'day') return ms + k * DAY;
    if (unit === 'week') return ms + 7 * k * DAY;
    const dt = new Date(ms);
    const months = unit === 'year' ? 12 * k : unit === 'quarter' ? 3 * k : k;
    const first = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(dt.getUTCDate(), lastDay));
  };

  if (f.period === 'last') {
    const end = includeToday ? today : today - DAY;
    return [isoDay(add(end, f.unit, -count) + DAY), isoDay(end)];
  }
  if (f.period === 'next') {
    const start = includeToday ? today : today + DAY;
    return [isoDay(start), isoDay(add(start, f.unit, count) - DAY)];
  }
  if (f.unit === 'day') return [isoDay(today), isoDay(today)];
  if (f.unit === 'week') {
    const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
    return [isoDay(monday), isoDay(monday + 6 * DAY)];
  }
  if (f.unit === 'month') return [isoDay(Date.UTC(y, m - 1, 1)), isoDay(Date.UTC(y, m, 0))];
  if (f.unit === 'quarter') {
    const q0 = Math.floor((m - 1) / 3) * 3;
    return [isoDay(Date.UTC(y, q0, 1)), isoDay(Date.UTC(y, q0 + 3, 0))];
  }
  return [isoDay(Date.UTC(y, 0, 1)), isoDay(Date.UTC(y, 11, 31))];
}

/** Returns a SQL predicate, or null when the filter's table isn't reachable from the base. */
function compileFilter(ctx, f) {
  if (!f || typeof f !== 'object') throw badRequest('Each filter must be an object with kind and target.');
  const col = findColumn(ctx.model, f.target);
  if (!ctx.plan.reaches(f.target.table)) return null;
  const ref = `${ctx.plan.alias(f.target.table)}.${quoteIdent(col.name)}`;
  const where = `Filter on "${f.target.table}"."${col.name}"`;
  const bind = (v) => ctx.params.add(coerce(col, v, where));

  switch (f.kind) {
    case 'basic': {
      if (f.operator !== 'in' && f.operator !== 'notIn') throw badRequest(`${where}: operator must be "in" or "notIn".`);
      if (!Array.isArray(f.values) || f.values.length > LIMITS.inValues) throw badRequest(`${where}: values must be an array of at most ${LIMITS.inValues} items.`);
      if (!f.values.length) return '1 = 1';
      const hasBlank = f.values.includes(null);
      const list = f.values.filter((v) => v !== null).map(bind).join(', ');
      if (f.operator === 'in') {
        return `(${[list && `${ref} IN (${list})`, hasBlank && `${ref} IS NULL`].filter(Boolean).join(' OR ')})`;
      }
      if (!list) return `${ref} IS NOT NULL`;
      return hasBlank ? `(${ref} IS NOT NULL AND ${ref} NOT IN (${list}))` : `(${ref} IS NULL OR ${ref} NOT IN (${list}))`;
    }

    case 'advanced': {
      const logic = f.logic === 'or' ? ' OR ' : f.logic === 'and' || f.logic === undefined ? ' AND ' : null;
      if (!logic) throw badRequest(`${where}: logic must be "and" or "or".`);
      if (!Array.isArray(f.conditions) || f.conditions.length < 1 || f.conditions.length > 2) {
        throw badRequest(`${where}: an advanced filter needs one or two conditions.`);
      }
      const text = col.dataType === 'text';
      const parts = f.conditions.map((c) => {
        const needsValue = !['isBlank', 'isNotBlank'].includes(c?.operator);
        if (needsValue && (c.value === null || c.value === undefined)) {
          throw badRequest(`${where}: "${c.operator}" needs a value; use isBlank to match blanks.`);
        }
        switch (c.operator) {
          case 'eq': return `${ref} = ${bind(c.value)}`;
          case 'ne': return `(${ref} IS NULL OR ${ref} <> ${bind(c.value)})`;
          case 'gt': return `${ref} > ${bind(c.value)}`;
          case 'gte': return `${ref} >= ${bind(c.value)}`;
          case 'lt': return `${ref} < ${bind(c.value)}`;
          case 'lte': return `${ref} <= ${bind(c.value)}`;
          case 'contains':
          case 'notContains':
          case 'startsWith': {
            if (!text) throw badRequest(`${where}: "${c.operator}" only applies to text columns.`);
            if (typeof c.value !== 'string' || !c.value) throw badRequest(`${where}: "${c.operator}" needs non-empty text.`);
            const pattern = c.operator === 'startsWith' ? `${likeEscape(c.value)}%` : `%${likeEscape(c.value)}%`;
            const ph = ctx.params.add(pattern);
            return c.operator === 'notContains'
              ? `(${ref} IS NULL OR ${ref} NOT LIKE ${ph} ESCAPE '\\')`
              : `${ref} LIKE ${ph} ESCAPE '\\'`;
          }
          case 'isBlank': return text ? `(${ref} IS NULL OR ${ref} = '')` : `${ref} IS NULL`;
          case 'isNotBlank': return text ? `(${ref} IS NOT NULL AND ${ref} <> '')` : `${ref} IS NOT NULL`;
          default: throw badRequest(`${where}: unknown operator "${c?.operator}".`);
        }
      });
      return `(${parts.join(logic)})`;
    }

    case 'range': {
      if (!['integer', 'number', 'date', 'datetime'].includes(col.dataType)) throw badRequest(`${where}: range filters need a number, date or date-time column.`);
      const parts = [];
      if (f.min !== undefined && f.min !== null) parts.push(`${ref} >= ${bind(f.min)}`);
      if (f.max !== undefined && f.max !== null) parts.push(`${ref} <= ${bind(f.max)}`);
      return parts.length ? `(${parts.join(' AND ')})` : '1 = 1';
    }

    case 'relativeDate': {
      if (col.dataType !== 'date' && col.dataType !== 'datetime') throw badRequest(`${where}: relative date filters need a date or date-time column.`);
      const [from, to] = relativeRange(f, ctx.asOf);
      if (col.dataType === 'datetime') {
        // Whole days: everything from the first day's midnight up to (not including) the midnight after the last day.
        const endExclusive = isoDateTime(Date.parse(`${to}T00:00:00Z`) + DAY_MS);
        return `(${ref} >= ${ctx.params.add(`${from} 00:00:00`)} AND ${ref} < ${ctx.params.add(endExclusive)})`;
      }
      return `(${ref} >= ${ctx.params.add(from)} AND ${ref} <= ${ctx.params.add(to)})`;
    }

    case 'relativeTime': {
      if (col.dataType !== 'datetime') throw badRequest(`${where}: relative time filters need a date-time column.`);
      if (f.period !== 'last' && f.period !== 'next') throw badRequest(`${where}: relative time period must be last or next.`);
      if (f.unit !== 'minute' && f.unit !== 'hour') throw badRequest(`${where}: relative time unit must be minute or hour.`);
      if (!Number.isInteger(f.count) || f.count < 1 || f.count > 100000) throw badRequest(`${where}: count must be a whole number from 1 to 100000.`);
      const span = f.count * (f.unit === 'hour' ? 3600000 : 60000);
      const [from, to] = f.period === 'last' ? [ctx.now - span, ctx.now] : [ctx.now, ctx.now + span];
      return `(${ref} >= ${ctx.params.add(isoDateTime(from))} AND ${ref} <= ${ctx.params.add(isoDateTime(to))})`;
    }

    case 'topN': {
      if (!Number.isInteger(f.n) || f.n < 1 || f.n > 1000) throw badRequest(`${where}: n must be a whole number from 1 to 1000.`);
      if (f.direction !== 'top' && f.direction !== 'bottom') throw badRequest(`${where}: direction must be "top" or "bottom".`);
      const measure = findMeasure(ctx.model, f.by);
      if (measure.table !== ctx.plan.base) {
        throw badRequest(`${where}: Top N by [${measure.name}] needs a measure on "${ctx.plan.base}"; it is on "${measure.table}".`);
      }
      // Ranked under the other (non-Top N) filters, like Power BI. Blank categories are not ranked.
      const inner = createPlan(ctx.model, ctx.plan.base);
      const innerCtx = { ...ctx, plan: inner };
      const innerRef = `${inner.alias(f.target.table)}.${quoteIdent(col.name)}`;
      const others = ctx.filters.filter((o) => o !== f && o?.kind !== 'topN').map((o) => compileFilter(innerCtx, o)).filter(Boolean);
      const m = compileExpression(ctx.model, measure.table, measure.expression, { aliasFor: (t) => inner.alias(t) }, [measure.name]).sql;
      const innerWhere = [`${innerRef} IS NOT NULL`, ...others].join(' AND ');
      const dir = f.direction === 'top' ? 'DESC' : 'ASC';
      return `${ref} IN (SELECT ${innerRef} ${inner.fromSql()} WHERE ${innerWhere} GROUP BY ${innerRef} ORDER BY ${m} IS NULL, ${m} ${dir} LIMIT ${f.n})`;
    }

    default:
      throw badRequest(`Unknown filter kind "${f.kind}". Use basic, advanced, range, relativeDate, relativeTime or topN.`);
  }
}

function compileFilters(ctx, filters) {
  if (filters === undefined) filters = [];
  if (!Array.isArray(filters)) throw badRequest('filters must be an array.');
  if (filters.length > LIMITS.filters) throw badRequest(`At most ${LIMITS.filters} filters are allowed.`);
  const parts = [];
  const ignored = [];
  filters.forEach((f, i) => {
    const sql = compileFilter({ ...ctx, filters }, f);
    if (sql === null) ignored.push(i);
    else parts.push(sql);
  });
  return { parts, ignored };
}

const whereOf = (parts) => (parts.length ? `WHERE ${parts.join(' AND ')}` : '');

function groupExpr(ctx, g) {
  const col = findColumn(ctx.model, g);
  if (!ctx.plan.reaches(g.table)) {
    throw badRequest(`Can't group by "${g.table}"."${g.column}": no many-to-one relationship path from "${ctx.plan.base}" to "${g.table}".`);
  }
  const alias = ctx.plan.alias(g.table);
  const ref = `${alias}.${quoteIdent(col.name)}`;
  if (g.dateLevel !== undefined) {
    if (col.dataType !== 'date' && col.dataType !== 'datetime') throw badRequest(`dateLevel needs a date or date-time column; "${col.name}" is ${col.dataType}.`);
    const sql = {
      year: `strftime('%Y', ${ref})`,
      quarter: `(strftime('%Y', ${ref}) || '-Q' || ((CAST(strftime('%m', ${ref}) AS INTEGER) + 2) / 3))`,
      month: `strftime('%Y-%m', ${ref})`,
    }[g.dateLevel];
    if (!sql) throw badRequest('dateLevel must be year, quarter or month.');
    return { col, dateLevel: g.dateLevel, sql, sortSql: sql };
  }
  return { col, sql: ref, sortSql: col.sortBy ? `MIN(${alias}.${quoteIdent(col.sortBy)})` : ref };
}

function boundedInt(value, fallback, min, max, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw badRequest(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
}

const toNumber = (v) => (v === null || v === undefined ? null : Number(v));
const outValue = (dataType, v) => (dataType === 'boolean' && v !== null ? Boolean(v) : v);

function runQuery(model, db, q) {
  if (!q || typeof q !== 'object') throw badRequest('Send a VisualQuery object.');
  const groupBy = q.groupBy ?? [];
  if (!Array.isArray(groupBy) || groupBy.length > 2) throw badRequest('groupBy must be an array of at most 2 fields.');
  if (!Array.isArray(q.measures) || !q.measures.length || q.measures.length > 10) throw badRequest('measures must list 1 to 10 measure names.');

  const measures = q.measures.map((name) => findMeasure(model, name));
  const base = measures[0].table;
  const other = measures.find((m) => m.table !== base);
  if (other) {
    throw badRequest(`Measures in one visual must share a home table: [${measures[0].name}] is on "${base}", [${other.name}] is on "${other.table}".`);
  }

  const plan = createPlan(model, base);
  const params = new Params();
  const ctx = { model, plan, params, ...resolveClock(q.asOf) };
  const aliasFor = (t) => plan.alias(t);

  const groups = groupBy.map((g) => groupExpr(ctx, g));
  const where = compileFilters(ctx, q.filters);
  where.parts.unshift(...compileFilters(ctx, model.datasetFilters).parts); // I10: dataset filters always apply
  const highlight = q.highlight === undefined ? null : compileFilters(ctx, q.highlight);
  const highlightSql = highlight?.parts.length ? `(${highlight.parts.join(' AND ')})` : null;

  const select = [
    ...groups.map((g, i) => `${g.sql} AS k${i}`),
    ...measures.map((m, i) => `${compileExpression(model, base, m.expression, { aliasFor }, [m.name]).sql} AS v${i}`),
    ...(highlightSql ? measures.map((m, i) => `${compileExpression(model, base, m.expression, { aliasFor, highlight: highlightSql }, [m.name]).sql} AS h${i}`) : []),
  ];

  let order = '';
  if (groups.length) {
    const by = q.orderBy?.by ?? 'category';
    if (by === 'measure') {
      const idx = boundedInt(q.orderBy.index, 0, 0, measures.length - 1, 'orderBy.index');
      order = `ORDER BY v${idx} IS NULL, v${idx} ${q.orderBy.direction === 'asc' ? 'ASC' : 'DESC'}`;
    } else if (by === 'category') {
      const dir = q.orderBy?.direction === 'desc' ? 'DESC' : 'ASC';
      order = `ORDER BY ${groups.map((g) => `${g.sortSql} ${dir}`).join(', ')}`;
    } else {
      throw badRequest('orderBy.by must be "category" or "measure".');
    }
  }
  const limit = boundedInt(q.limit, LIMITS.groups, 1, LIMITS.groups, 'limit');

  const sql = [
    `SELECT ${select.join(', ')}`,
    plan.fromSql(),
    whereOf(where.parts),
    groups.length ? `GROUP BY ${groups.map((g) => g.sql).join(', ')}` : '',
    order,
    groups.length ? `LIMIT ${limit + 1}` : '',
  ].filter(Boolean).join(' ');

  const raw = db.prepare(sql).all(params.for(sql));
  return {
    columns: [
      ...groups.map((g) => ({ name: g.dateLevel ? `${g.col.name} (${g.dateLevel})` : g.col.name, role: 'group', dataType: g.dateLevel ? 'text' : g.col.dataType })),
      ...measures.map((m) => ({ name: m.name, role: 'measure', dataType: 'number', format: m.format })),
    ],
    rows: raw.slice(0, limit).map((r) => ({
      keys: groups.map((g, i) => outValue(g.dateLevel ? 'text' : g.col.dataType, r[`k${i}`])),
      values: measures.map((_, i) => toNumber(r[`v${i}`])),
      highlights: highlightSql ? measures.map((_, i) => toNumber(r[`h${i}`])) : null,
    })),
    truncated: raw.length > limit,
    ignoredFilters: where.ignored,
    ignoredHighlight: highlight ? highlight.ignored : [],
  };
}

function runRows(model, db, r) {
  if (!r || typeof r !== 'object') throw badRequest('Send a RowsRequest object.');
  let fields;
  if (Array.isArray(r.columns) && r.columns.length) {
    if (r.columns.length > 100) throw badRequest('At most 100 columns can be requested.');
    fields = r.columns.map((ref) => ({ ref, col: findColumn(model, ref) }));
  } else {
    if (typeof r.table !== 'string') throw badRequest('Send either columns or a table.');
    const table = findTable(model, r.table);
    fields = table.columns.filter((c) => !c.hidden).map((col) => ({ ref: { table: table.name, column: col.name }, col }));
  }

  const tables = [...new Set(fields.map((f) => f.ref.table))];
  let plan = null;
  for (const candidate of typeof r.table === 'string' ? [r.table] : tables) {
    const p = createPlan(model, candidate);
    if (tables.every((t) => p.reaches(t))) {
      plan = p;
      break;
    }
  }
  if (!plan) throw badRequest(`These columns come from tables that aren't linked by many-to-one relationships: ${tables.join(', ')}.`);

  const params = new Params();
  const ctx = { model, plan, params, ...resolveClock(r.asOf) };
  const select = fields.map((f, i) => `${plan.alias(f.ref.table)}.${quoteIdent(f.col.name)} AS c${i}`);
  const where = compileFilters(ctx, r.filters);
  where.parts.unshift(...compileFilters(ctx, model.datasetFilters).parts); // I10: dataset filters always apply
  const offset = boundedInt(r.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
  const limit = boundedInt(r.limit, LIMITS.defaultRows, 1, LIMITS.rows, 'limit');
  const from = plan.fromSql();
  const whereSql = whereOf(where.parts);

  // WITHOUT ROWID tables have no rowid; their primary key already gives a stable order.
  const baseTable = model.tables.find((t) => t.name === plan.base);
  const orderBy = baseTable?.withoutRowid ? '' : 'ORDER BY t0.rowid';
  const rowsSql = `SELECT ${select.join(', ')} ${from} ${whereSql} ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
  const countSql = `SELECT COUNT(*) AS c ${from} ${whereSql}`;
  return {
    columns: fields.map((f) => ({ table: f.ref.table, name: f.col.name, dataType: f.col.dataType })),
    rows: db.prepare(rowsSql).all(params.for(rowsSql)).map((row) => fields.map((f, i) => outValue(f.col.dataType, row[`c${i}`]))),
    total: db.prepare(countSql).get(params.for(countSql)).c,
    ignoredFilters: where.ignored,
  };
}

function runValues(model, db, v) {
  if (!v || typeof v !== 'object') throw badRequest('Send a ValuesRequest object.');
  const col = findColumn(model, v.target);
  const plan = createPlan(model, v.target.table);
  const params = new Params();
  const ctx = { model, plan, params, ...resolveClock(v.asOf) };
  const alias = plan.alias(v.target.table);
  const ref = `${alias}.${quoteIdent(col.name)}`;
  const where = compileFilters(ctx, v.filters);
  where.parts.unshift(...compileFilters(ctx, model.datasetFilters).parts); // I10: dataset filters always apply
  const rangeWhere = whereOf(where.parts);

  if (v.search !== undefined && v.search !== '') {
    if (typeof v.search !== 'string' || v.search.length > 200) throw badRequest('search must be text of at most 200 characters.');
    where.parts.push(`CAST(${ref} AS TEXT) LIKE ${params.add(`%${likeEscape(v.search)}%`)} ESCAPE '\\'`);
  }
  const limit = boundedInt(v.limit, LIMITS.defaultValues, 1, LIMITS.values, 'limit');
  const order = col.sortBy ? `MIN(${alias}.${quoteIdent(col.sortBy)})` : ref;
  const from = plan.fromSql();
  const valuesSql = `SELECT ${ref} AS v ${from} ${whereOf(where.parts)} GROUP BY ${ref} ORDER BY ${order} LIMIT ${limit + 1}`;
  const raw = db.prepare(valuesSql).all(params.for(valuesSql));

  let min = null;
  let max = null;
  if (['integer', 'number', 'date', 'datetime'].includes(col.dataType)) {
    const rangeSql = `SELECT MIN(${ref}) AS mn, MAX(${ref}) AS mx ${from} ${rangeWhere}`;
    const mm = db.prepare(rangeSql).get(params.for(rangeSql));
    min = mm.mn;
    max = mm.mx;
  }
  return {
    values: raw.slice(0, limit).map((r) => outValue(col.dataType, r.v)),
    truncated: raw.length > limit,
    min,
    max,
    ignoredFilters: where.ignored,
  };
}

module.exports = { runQuery, runRows, runValues, relativeRange, createPlan, LIMITS };

'use strict';

/**
 * DAX-subset formulas compiled to SQL on the server (spec R5, F1–F6), so
 * measures evaluate per group in each visual's filter context and calculated
 * columns evaluate per row.
 *
 * Two modes:
 * - "measure": aggregations (COUNTROWS, SUM … DISTINCTCOUNT, COUNTBLANK),
 *   iterators (SUMX, AVERAGEX, MINX, MAXX, COUNTX) and [Measure] references,
 *   combined with arithmetic, logic, text and date functions;
 * - "row": calculated columns and iterator bodies — the same functions over one
 *   row's columns, with no aggregation and no measure references.
 *
 * Every table and column name is resolved against the model (invariant I1).
 * Every text literal, format pattern and "now" is a bound parameter (I11), so
 * nothing a formula author types reaches SQL text.
 */

const { badRequest } = require('./errors');
const { quoteIdent, findMeasure } = require('./model');

const AGGREGATES = { SUM: 'SUM', AVERAGE: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', DISTINCTCOUNT: 'COUNT' };
const ITERATORS = { SUMX: 'SUM', AVERAGEX: 'AVG', MINX: 'MIN', MAXX: 'MAX', COUNTX: 'COUNT' };
const NUMERIC_ONLY = new Set(['SUM', 'AVERAGE']);
const DATE_INTERVALS = new Set(['SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Supported functions by group — for error messages and the editor's reference list. */
const FUNCTION_GROUPS = {
  Aggregation: ['COUNTROWS', 'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'DISTINCTCOUNT', 'COUNTBLANK', 'SUMX', 'AVERAGEX', 'MINX', 'MAXX', 'COUNTX'],
  Logical: ['IF', 'SWITCH', 'AND', 'OR', 'NOT', 'TRUE', 'FALSE', 'BLANK', 'ISBLANK'],
  Math: ['DIVIDE'],
  Text: ['CONCATENATE', 'LEFT', 'RIGHT', 'MID', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'FORMAT'],
  Date: ['TODAY', 'NOW', 'DATE', 'YEAR', 'MONTH', 'DAY', 'WEEKDAY', 'DATEDIFF', 'EOMONTH'],
};
const SUPPORTED = Object.values(FUNCTION_GROUPS).flat();

// --- Types ---------------------------------------------------------------------
// Expression types: number, integer, boolean, text, date, datetime, blank.

const NUMERIC = new Set(['number', 'integer', 'boolean', 'blank']);
const DATES = new Set(['date', 'datetime']);
const TYPE_NAMES = { text: 'text', number: 'a number', integer: 'a number', boolean: 'true/false', date: 'a date', datetime: 'a date-time', blank: 'blank' };
const describeType = (type) => TYPE_NAMES[type] ?? type;
const family = (type) => (type === 'blank' ? 'blank' : NUMERIC.has(type) ? 'number' : DATES.has(type) ? 'date' : 'text');

/** The result type of IF / SWITCH branches. Mixed text and non-text results read as text. */
function unify(types) {
  const known = types.filter((t) => t !== 'blank');
  if (!known.length) return 'blank';
  if (known.every((t) => t === known[0])) return known[0];
  const families = new Set(known.map(family));
  if (families.size === 1) return families.has('number') ? 'number' : families.has('date') ? 'datetime' : 'text';
  return 'text';
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoDateTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// --- Tokenizer and parser ------------------------------------------------------

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const start = i;
    const two = src.slice(i, i + 2);
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      tokens.push({ type: 'number', value: Number(m[0]), pos: start });
      i += m[0].length;
    } else if (ch === '[') {
      let name = '';
      i++;
      while (i < src.length) {
        if (src[i] === ']') {
          if (src[i + 1] === ']') { name += ']'; i += 2; continue; }
          break;
        }
        name += src[i++];
      }
      if (src[i] !== ']') throw badRequest('Unclosed "[" — every column or measure name needs a closing "]".', start);
      i++;
      tokens.push({ type: 'bracket', value: name.trim(), pos: start });
    } else if (ch === "'") {
      let name = '';
      i++;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") { name += "'"; i += 2; continue; }
          break;
        }
        name += src[i++];
      }
      if (src[i] !== "'") throw badRequest('Unclosed quote in a table name.', start);
      i++;
      tokens.push({ type: 'ident', value: name, pos: start });
    } else if (ch === '"') {
      let text = '';
      i++;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') { text += '"'; i += 2; continue; }
          break;
        }
        text += src[i++];
      }
      if (src[i] !== '"') throw badRequest('Unclosed text — every "…" needs a closing double quote.', start);
      i++;
      tokens.push({ type: 'string', value: text, pos: start });
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      tokens.push({ type: 'ident', value: m[0], pos: start });
      i += m[0].length;
    } else if (['&&', '||', '<>', '<=', '>=', '=='].includes(two)) {
      tokens.push({ type: two === '==' ? '=' : two, pos: start });
      i += 2;
    } else if ('+-*/(),&=<>'.includes(ch)) {
      tokens.push({ type: ch, pos: start });
      i++;
    } else {
      throw badRequest(`Unexpected character "${ch}".`, start);
    }
  }
  return tokens;
}

const COMPARISONS = new Set(['=', '<>', '<', '<=', '>', '>=']);

/**
 * Precedence, lowest first (as in DAX): ||, &&, comparisons, & (concatenate),
 * + -, * /, unary minus.
 */
function parse(src) {
  if (typeof src !== 'string' || !src.trim()) throw badRequest('Enter an expression, for example COUNTROWS(Table).', 0);
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const endPos = src.length;
  const expect = (type, what) => {
    const t = tokens[p];
    if (!t || t.type !== type) throw badRequest(`Expected ${what}.`, t ? t.pos : endPos);
    p++;
    return t;
  };

  function orExpr() {
    let left = andExpr();
    while (peek()?.type === '||') {
      const op = tokens[p++];
      left = { type: 'logical', op: 'OR', left, right: andExpr(), pos: op.pos };
    }
    return left;
  }
  function andExpr() {
    let left = comparison();
    while (peek()?.type === '&&') {
      const op = tokens[p++];
      left = { type: 'logical', op: 'AND', left, right: comparison(), pos: op.pos };
    }
    return left;
  }
  function comparison() {
    let left = concat();
    while (peek() && COMPARISONS.has(peek().type)) {
      const op = tokens[p++];
      left = { type: 'compare', op: op.type, left, right: concat(), pos: op.pos };
    }
    return left;
  }
  function concat() {
    let left = additive();
    while (peek()?.type === '&') {
      const op = tokens[p++];
      left = { type: 'concat', left, right: additive(), pos: op.pos };
    }
    return left;
  }
  function additive() {
    let left = term();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[p++];
      left = { type: 'binary', op: op.type, left, right: term(), pos: op.pos };
    }
    return left;
  }
  function term() {
    let left = unary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = tokens[p++];
      left = { type: 'binary', op: op.type, left, right: unary(), pos: op.pos };
    }
    return left;
  }
  function unary() {
    if (peek() && peek().type === '-') {
      const op = tokens[p++];
      return { type: 'negate', arg: unary(), pos: op.pos };
    }
    return primary();
  }
  function primary() {
    const t = peek();
    if (!t) throw badRequest('The expression ends too early.', endPos);
    if (t.type === 'number') { p++; return { type: 'number', value: t.value, pos: t.pos }; }
    if (t.type === 'string') { p++; return { type: 'string', value: t.value, pos: t.pos }; }
    if (t.type === '(') {
      p++;
      const inner = orExpr();
      expect(')', '")"');
      return inner;
    }
    if (t.type === 'bracket') { p++; return { type: 'ref', name: t.value, pos: t.pos }; }
    if (t.type === 'ident') {
      p++;
      if (peek() && peek().type === '(') {
        p++;
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(orExpr());
          while (peek() && peek().type === ',') { p++; args.push(orExpr()); }
        }
        expect(')', `")" to close ${t.value}(`);
        return { type: 'call', name: t.value.toUpperCase(), args, pos: t.pos };
      }
      if (peek() && peek().type === 'bracket') {
        const col = tokens[p++];
        return { type: 'column', table: t.value, column: col.value, pos: t.pos };
      }
      return { type: 'table', name: t.value, pos: t.pos };
    }
    throw badRequest(`Unexpected "${t.type}".`, t.pos);
  }

  const ast = orExpr();
  if (p < tokens.length) throw badRequest('Unexpected text after the end of the expression.', tokens[p].pos);
  return ast;
}

// --- Compiler ------------------------------------------------------------------

/** Placeholders for compiles that never execute (validation, type inference). */
function scratchBinder() {
  let n = 0;
  return () => `$x${n++}`;
}

/**
 * ctx.aliasFor(table) -> SQL alias; ctx.highlight -> SQL predicate or null;
 * ctx.bind(value) -> bound parameter placeholder; ctx.now -> epoch ms for
 * TODAY() and NOW(); ctx.mode -> "measure" (default) or "row".
 */
function makeContext(ctx = {}) {
  return {
    aliasFor: ctx.aliasFor || quoteIdent,
    highlight: ctx.highlight || null,
    bind: ctx.bind || scratchBinder(),
    now: ctx.now ?? Date.now(),
    mode: ctx.mode === 'row' ? 'row' : 'measure',
  };
}

/** Text form of a value for & and text functions: whole numbers without ".0", booleans as TRUE / FALSE. */
function asText(e) {
  if (e.type === 'text') return e.sql;
  if (e.type === 'blank') return 'NULL';
  if (e.type === 'boolean') return `(CASE ${e.sql} WHEN 1 THEN 'TRUE' WHEN 0 THEN 'FALSE' END)`;
  if (e.type === 'number' || e.type === 'integer') {
    return `(CASE WHEN typeof(${e.sql}) = 'real' AND ${e.sql} = CAST(${e.sql} AS INTEGER) THEN CAST(CAST(${e.sql} AS INTEGER) AS TEXT) ELSE CAST(${e.sql} AS TEXT) END)`;
  }
  return `CAST(${e.sql} AS TEXT)`;
}

const NUMBER_FORMAT = /^(#,##0|#,0|0)(?:\.(0+))?(%)?$/;

/** FORMAT(value, "pattern") for number patterns ("#,0.0", "0.0%") and date patterns ("dd MMM yyyy"). Blank formats as "". */
function formatSql(value, pattern, patternNode, bind) {
  const m = NUMBER_FORMAT.exec(pattern);
  if (m) {
    if (!NUMERIC.has(value.type)) throw badRequest(`"${pattern}" is a number format; this value is ${describeType(value.type)}.`, patternNode.pos);
    const decimals = m[2]?.length ?? 0;
    const v = m[3] ? `((${value.sql}) * 100.0)` : `(${value.sql})`;
    let body;
    if (m[1] === '0') {
      body = `printf(${bind(`%.${decimals}f`)}, ${v})`;
    } else {
      const rounded = `round(abs(${v}), ${decimals})`;
      const whole = `CAST(${rounded} AS INTEGER)`;
      const sign = `(CASE WHEN ${v} < 0 AND ${rounded} > 0 THEN '-' ELSE '' END)`;
      const fraction = decimals ? ` || substr(printf(${bind(`%.${decimals}f`)}, ${rounded} - ${whole}), 2)` : '';
      body = `${sign} || printf(${bind('%,d')}, ${whole})${fraction}`;
    }
    return { sql: `(CASE WHEN ${value.sql} IS NULL THEN '' ELSE ${body}${m[3] ? " || '%'" : ''} END)`, type: 'text' };
  }
  if (!/[yMdHms]/.test(pattern)) {
    throw badRequest('FORMAT supports number formats like "#,0.0" or "0.0%" and date formats like "dd-MM-yyyy".', patternNode.pos);
  }
  if (!DATES.has(value.type) && value.type !== 'blank') throw badRequest(`"${pattern}" is a date format; this value is ${describeType(value.type)}.`, patternNode.pos);
  const tokens = { yyyy: '%Y', MM: '%m', dd: '%d', HH: '%H', mm: '%M', ss: '%S' };
  const month = `(CASE strftime('%m', ${value.sql}) ${MONTH_NAMES.map((n, i) => `WHEN '${String(i + 1).padStart(2, '0')}' THEN '${n}'`).join(' ')} END)`;
  const pieces = [];
  pattern.split('MMM').forEach((chunk, i) => {
    if (i) pieces.push(month);
    if (chunk) pieces.push(`strftime(${bind(chunk.replace(/%/g, '%%').replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => tokens[t]))}, ${value.sql})`);
  });
  return { sql: `COALESCE(${pieces.join(' || ')}, '')`, type: 'text' };
}

/** A physical column, or a calculated column's row expression. Returns { sql, type }. */
function columnExpression(model, tableName, col, ctx, stack = []) {
  if (!col.expression) return { sql: `${ctx.aliasFor(tableName)}.${quoteIdent(col.name)}`, type: col.dataType };
  const key = `${tableName}[${col.name}]`;
  if (stack.includes(key)) throw badRequest(`Calculated column ${key} refers to itself: ${[...stack, key].join(' → ')}.`);
  const compiled = compileExpression(model, tableName, col.expression, { ...ctx, mode: 'row', highlight: null }, [...stack, key]);
  return { sql: `(${compiled.sql})`, type: compiled.dataType };
}

/** SQL for any column reference the query compiler emits (F5: calculated columns work wherever columns do). */
function columnSql(model, tableName, col, ctx = {}) {
  return columnExpression(model, tableName, col, makeContext(ctx)).sql;
}

/**
 * Compiles an expression whose rows come from `homeTable`.
 * Returns { sql, dataType, dependencies } (dependencies: measure names used).
 */
function compileExpression(model, homeTable, expression, context = {}, stack = []) {
  const ctx = makeContext(context);
  const dependencies = new Set();
  const result = compileNode(model, homeTable, parse(expression), ctx, stack, dependencies);
  return { sql: result.sql, dataType: result.type, dependencies: [...dependencies] };
}

function compileNode(model, homeTable, ast, ctx, stack, dependencies) {
  const home = model.tables.find((t) => t.name === homeTable);
  if (!home) throw badRequest(`Unknown home table "${homeTable}".`);
  const row = ctx.mode === 'row';
  const aggregate = (fn, inner) => (ctx.highlight ? `${fn}(CASE WHEN ${ctx.highlight} THEN ${inner} END)` : `${fn}(${inner})`);

  function needNumber(e, node, what) {
    if (NUMERIC.has(e.type)) return e;
    const hint = e.type === 'text' ? ' Use & to join text.' : DATES.has(e.type) ? ' Use DATEDIFF to compare dates.' : '';
    throw badRequest(`${what} needs a number; this is ${describeType(e.type)}.${hint}`, node.pos);
  }
  function needDate(e, node, what) {
    if (DATES.has(e.type) || e.type === 'blank') return e;
    throw badRequest(`${what} needs a date; this is ${describeType(e.type)}.`, node.pos);
  }
  function needCondition(e, node, what) {
    if (NUMERIC.has(e.type)) return e;
    throw badRequest(`${what} needs a true/false condition, such as ${homeTable}[column] = "value"; this is ${describeType(e.type)}.`, node.pos);
  }

  function homeColumn(name, node) {
    const col = home.columns.find((c) => c.name === name);
    if (!col) throw badRequest(`Unknown column "${name}" in table "${homeTable}".`, node.pos);
    return col;
  }
  function column(col, node) {
    try {
      return columnExpression(model, homeTable, col, ctx, stack);
    } catch (e) {
      if (e.status === 400 && e.position === undefined) throw badRequest(`In ${homeTable}[${col.name}]: ${e.message}`, node.pos);
      throw e;
    }
  }
  /** The column argument of SUM, MIN, COUNTBLANK …: Table[Column] or [Column] on the home table. */
  function aggregateArg(node, fnName) {
    let col;
    if (node.type === 'ref') {
      col = home.columns.find((c) => c.name === node.name);
      if (!col) throw badRequest(`"${node.name}" is not a column of ${homeTable}. Write ${homeTable}[column].`, node.pos);
    } else if (node.type === 'column') {
      if (node.table !== homeTable) {
        throw badRequest(`${fnName} must use the measure's home table "${homeTable}"; cross-table aggregation isn't supported yet.`, node.pos);
      }
      col = homeColumn(node.column, node);
    } else {
      throw badRequest(`${fnName} needs a column, for example ${fnName}(${homeTable}[column]).`, node.pos);
    }
    const e = column(col, node);
    if (NUMERIC_ONLY.has(fnName) && e.type !== 'integer' && e.type !== 'number') {
      throw badRequest(`${fnName} needs a numeric column; "${col.name}" is ${col.dataType}.`, node.pos);
    }
    return e;
  }

  function walk(node) {
    switch (node.type) {
      case 'number':
        return { sql: String(node.value), type: Number.isInteger(node.value) ? 'integer' : 'number' };
      case 'string':
        return { sql: ctx.bind(node.value), type: 'text' };
      case 'negate': {
        const a = needNumber(walk(node.arg), node, 'A minus sign');
        return { sql: `(-${a.sql})`, type: a.type === 'integer' ? 'integer' : 'number' };
      }
      case 'binary': {
        const l = needNumber(walk(node.left), node, `"${node.op}"`);
        const r = needNumber(walk(node.right), node, `"${node.op}"`);
        if (node.op === '/') return { sql: `(CAST(${l.sql} AS REAL) / NULLIF(${r.sql}, 0))`, type: 'number' };
        return { sql: `(${l.sql} ${node.op} ${r.sql})`, type: l.type === 'integer' && r.type === 'integer' ? 'integer' : 'number' };
      }
      case 'concat': {
        const l = walk(node.left);
        const r = walk(node.right);
        return { sql: `(COALESCE(${asText(l)}, '') || COALESCE(${asText(r)}, ''))`, type: 'text' };
      }
      case 'compare': {
        const l = walk(node.left);
        const r = walk(node.right);
        const [fl, fr] = [family(l.type), family(r.type)];
        if (fl !== 'blank' && fr !== 'blank' && fl !== fr) throw badRequest(`Can't compare ${describeType(l.type)} with ${describeType(r.type)}.`, node.pos);
        return { sql: `(${l.sql} ${node.op} ${r.sql})`, type: 'boolean' };
      }
      case 'logical': {
        const symbol = node.op === 'AND' ? '"&&"' : '"||"';
        const l = needCondition(walk(node.left), node, symbol);
        const r = needCondition(walk(node.right), node, symbol);
        return { sql: `(${l.sql} ${node.op} ${r.sql})`, type: 'boolean' };
      }
      case 'ref': {
        if (row) {
          const col = home.columns.find((c) => c.name === node.name);
          if (col) return column(col, node);
          if (model.measures.some((m) => m.name === node.name)) {
            throw badRequest(`[${node.name}] is a measure; a calculated column or an iterator body can only use columns of "${homeTable}".`, node.pos);
          }
          throw badRequest(`Unknown column [${node.name}] in table "${homeTable}".`, node.pos);
        }
        const measure = model.measures.find((m) => m.name === node.name);
        if (!measure) {
          const isColumn = home.columns.some((c) => c.name === node.name);
          throw badRequest(
            isColumn
              ? `[${node.name}] is a column; wrap it in an aggregation such as SUM(${homeTable}[${node.name}]).`
              : `Unknown measure [${node.name}].`,
            node.pos,
          );
        }
        if (measure.table !== homeTable) {
          throw badRequest(`[${measure.name}] belongs to "${measure.table}"; measures in one expression must share the home table "${homeTable}".`, node.pos);
        }
        if (stack.includes(measure.name)) {
          throw badRequest(`Measure [${measure.name}] refers to itself: ${[...stack, measure.name].join(' → ')}.`, node.pos);
        }
        dependencies.add(measure.name);
        let inner;
        try {
          inner = compileExpression(model, homeTable, measure.expression, ctx, [...stack, measure.name]);
        } catch (e) {
          if (e.status === 400 && !String(e.message).startsWith(`In [${measure.name}]`) && !stack.length) {
            throw badRequest(`In [${measure.name}]: ${e.message}`, node.pos);
          }
          throw e;
        }
        inner.dependencies.forEach((d) => dependencies.add(d));
        return { sql: `(${inner.sql})`, type: inner.dataType };
      }
      case 'call':
        return call(node);
      case 'column':
        if (row) {
          if (node.table !== homeTable) {
            throw badRequest(`${node.table}[${node.column}] is in another table; a row expression can only use columns of "${homeTable}" (RELATED isn't supported yet).`, node.pos);
          }
          return column(homeColumn(node.column, node), node);
        }
        throw badRequest(`${node.table}[${node.column}] must be inside an aggregation such as SUM(${node.table}[${node.column}]).`, node.pos);
      case 'table':
        throw badRequest(`"${node.name}" on its own isn't a value; did you mean COUNTROWS(${node.name})?`, node.pos);
      default:
        throw badRequest('Unsupported expression.', node.pos);
    }
  }

  function call(node) {
    const { name, args } = node;
    const arity = (min, max = min) => {
      if (args.length < min || args.length > max) {
        const count = min === max ? `${min} argument${min === 1 ? '' : 's'}` : `${min} to ${max} arguments`;
        throw badRequest(`${name} takes ${count}.`, node.pos);
      }
    };
    const measureOnly = () => {
      if (row) throw badRequest(`${name} aggregates rows, so it can't be used in a calculated column or an iterator body. Use it in a measure.`, node.pos);
    };
    const text = (i) => asText(walk(args[i]));
    const number = (i) => needNumber(walk(args[i]), args[i], name).sql;
    const date = (i) => needDate(walk(args[i]), args[i], name).sql;

    if (name === 'COUNTROWS') {
      measureOnly();
      if (args.length !== 1 || args[0].type !== 'table') throw badRequest('COUNTROWS takes one table, for example COUNTROWS(Table).', node.pos);
      if (args[0].name !== homeTable) throw badRequest(`COUNTROWS must count the measure's home table "${homeTable}".`, args[0].pos);
      return { sql: ctx.highlight ? `COUNT(CASE WHEN ${ctx.highlight} THEN 1 END)` : 'COUNT(*)', type: 'integer' };
    }
    if (name in AGGREGATES) {
      measureOnly();
      if (args.length !== 1) throw badRequest(`${name} takes one column.`, node.pos);
      const c = aggregateArg(args[0], name);
      if (name === 'DISTINCTCOUNT') {
        return { sql: ctx.highlight ? `COUNT(DISTINCT CASE WHEN ${ctx.highlight} THEN ${c.sql} END)` : `COUNT(DISTINCT ${c.sql})`, type: 'integer' };
      }
      return { sql: aggregate(AGGREGATES[name], c.sql), type: name === 'COUNT' ? 'integer' : name === 'MIN' || name === 'MAX' ? c.type : 'number' };
    }
    if (name === 'COUNTBLANK') {
      measureOnly();
      arity(1);
      const c = aggregateArg(args[0], name);
      const blank = c.type === 'text' ? `(${c.sql} IS NULL OR ${c.sql} = '')` : `${c.sql} IS NULL`;
      return { sql: `COUNT(CASE WHEN ${ctx.highlight ? `${ctx.highlight} AND ` : ''}${blank} THEN 1 END)`, type: 'integer' };
    }
    if (name in ITERATORS) {
      measureOnly();
      arity(2);
      if (args[0].type !== 'table') throw badRequest(`${name} needs a table first, for example ${name}(${homeTable}, ${homeTable}[column] * 2).`, args[0].pos);
      if (args[0].name !== homeTable) throw badRequest(`${name} must iterate the measure's home table "${homeTable}".`, args[0].pos);
      const body = compileNode(model, homeTable, args[1], { ...ctx, mode: 'row', highlight: null }, stack, dependencies);
      if ((name === 'SUMX' || name === 'AVERAGEX') && !NUMERIC.has(body.type)) {
        throw badRequest(`${name} needs a numeric expression; this is ${describeType(body.type)}.`, args[1].pos);
      }
      return { sql: aggregate(ITERATORS[name], body.sql), type: name === 'COUNTX' ? 'integer' : name === 'MINX' || name === 'MAXX' ? body.type : 'number' };
    }
    if (name === 'DIVIDE') {
      if (args.length < 2 || args.length > 3) throw badRequest('DIVIDE takes a numerator, a denominator and an optional alternate result.', node.pos);
      const [a, b] = [number(0), number(1)];
      const alt = args[2] ? number(2) : 'NULL';
      return { sql: `(CASE WHEN ${b} IS NULL OR ${b} = 0 THEN ${alt} ELSE CAST(${a} AS REAL) / ${b} END)`, type: 'number' };
    }

    // Logical (F1)
    if (name === 'IF') {
      arity(2, 3);
      const condition = needCondition(walk(args[0]), args[0], 'IF');
      const a = walk(args[1]);
      const b = args[2] ? walk(args[2]) : { sql: 'NULL', type: 'blank' };
      return { sql: `(CASE WHEN ${condition.sql} THEN ${a.sql} ELSE ${b.sql} END)`, type: unify([a.type, b.type]) };
    }
    if (name === 'SWITCH') {
      if (args.length < 3) throw badRequest('SWITCH takes an expression, then value / result pairs, then an optional else result.', node.pos);
      const searched = args[0].type === 'call' && args[0].name === 'TRUE' && !args[0].args.length;
      const subject = searched ? null : walk(args[0]);
      const branches = [];
      const types = [];
      for (let i = 1; i + 1 < args.length; i += 2) {
        const when = walk(args[i]);
        if (searched) needCondition(when, args[i], 'SWITCH(TRUE(), …)');
        else if (family(when.type) !== 'blank' && family(subject.type) !== 'blank' && family(when.type) !== family(subject.type)) {
          throw badRequest(`SWITCH compares ${describeType(subject.type)} with ${describeType(when.type)}.`, args[i].pos);
        }
        const then = walk(args[i + 1]);
        branches.push(`WHEN ${when.sql} THEN ${then.sql}`);
        types.push(then.type);
      }
      const otherwise = (args.length - 1) % 2 === 1 ? walk(args[args.length - 1]) : { sql: 'NULL', type: 'blank' };
      types.push(otherwise.type);
      return { sql: `(CASE ${subject ? `${subject.sql} ` : ''}${branches.join(' ')} ELSE ${otherwise.sql} END)`, type: unify(types) };
    }
    if (name === 'AND' || name === 'OR') {
      arity(2);
      const [a, b] = [needCondition(walk(args[0]), args[0], name), needCondition(walk(args[1]), args[1], name)];
      return { sql: `(${a.sql} ${name} ${b.sql})`, type: 'boolean' };
    }
    if (name === 'NOT') {
      arity(1);
      return { sql: `(NOT ${needCondition(walk(args[0]), args[0], 'NOT').sql})`, type: 'boolean' };
    }
    if (name === 'TRUE' || name === 'FALSE') {
      arity(0);
      return { sql: name === 'TRUE' ? '1' : '0', type: 'boolean' };
    }
    if (name === 'BLANK') {
      arity(0);
      return { sql: 'NULL', type: 'blank' };
    }
    if (name === 'ISBLANK') {
      arity(1);
      return { sql: `(${walk(args[0]).sql} IS NULL)`, type: 'boolean' };
    }

    // Text (F2)
    if (name === 'CONCATENATE') {
      arity(2);
      return { sql: `(COALESCE(${text(0)}, '') || COALESCE(${text(1)}, ''))`, type: 'text' };
    }
    if (name === 'LEFT' || name === 'RIGHT') {
      arity(1, 2);
      const t = text(0);
      const n = args[1] ? number(1) : '1';
      return { sql: name === 'LEFT' ? `substr(${t}, 1, ${n})` : `(CASE WHEN ${n} <= 0 THEN '' ELSE substr(${t}, -(${n})) END)`, type: 'text' };
    }
    if (name === 'MID') {
      arity(3);
      return { sql: `substr(${text(0)}, ${number(1)}, ${number(2)})`, type: 'text' };
    }
    if (name === 'LEN') {
      arity(1);
      return { sql: `COALESCE(length(${text(0)}), 0)`, type: 'integer' };
    }
    if (name === 'UPPER' || name === 'LOWER' || name === 'TRIM') {
      arity(1);
      return { sql: `${name.toLowerCase()}(${text(0)})`, type: 'text' };
    }
    if (name === 'FORMAT') {
      arity(2);
      if (args[1].type !== 'string') throw badRequest('FORMAT needs its format in double quotes, for example FORMAT([Sales], "#,0").', args[1].pos);
      return formatSql(walk(args[0]), args[1].value, args[1], ctx.bind);
    }

    // Date (F3)
    if (name === 'TODAY') {
      arity(0);
      return { sql: ctx.bind(isoDay(ctx.now)), type: 'date' };
    }
    if (name === 'NOW') {
      arity(0);
      return { sql: ctx.bind(isoDateTime(ctx.now)), type: 'datetime' };
    }
    if (name === 'DATE') {
      arity(3);
      const [y, m, d] = [number(0), number(1), number(2)];
      return {
        sql: `date(printf('%04d-01-01', CAST(${y} AS INTEGER)), (CAST(${m} AS INTEGER) - 1) || ' months', (CAST(${d} AS INTEGER) - 1) || ' days')`,
        type: 'date',
      };
    }
    if (name === 'YEAR' || name === 'MONTH' || name === 'DAY') {
      arity(1);
      const spec = { YEAR: '%Y', MONTH: '%m', DAY: '%d' }[name];
      return { sql: `CAST(strftime('${spec}', ${date(0)}) AS INTEGER)`, type: 'integer' };
    }
    if (name === 'WEEKDAY') {
      arity(1, 2);
      const kind = args[1] ? args[1].value : 1;
      if (args[1] && (args[1].type !== 'number' || ![1, 2, 3].includes(kind))) {
        throw badRequest('WEEKDAY\'s second argument is 1 (Sunday = 1), 2 (Monday = 1) or 3 (Monday = 0).', args[1].pos);
      }
      const w = `CAST(strftime('%w', ${date(0)}) AS INTEGER)`;
      return { sql: kind === 1 ? `(${w} + 1)` : kind === 2 ? `((${w} + 6) % 7 + 1)` : `((${w} + 6) % 7)`, type: 'integer' };
    }
    if (name === 'DATEDIFF') {
      arity(3);
      const interval = args[2].type === 'table' ? args[2].name.toUpperCase() : null;
      if (!interval || !DATE_INTERVALS.has(interval)) {
        throw badRequest("DATEDIFF's third argument is the interval: DAY, WEEK, MONTH, QUARTER, YEAR, HOUR, MINUTE or SECOND.", args[2].pos);
      }
      const [s, e] = [date(0), date(1)];
      const year = (d) => `CAST(strftime('%Y', ${d}) AS INTEGER)`;
      const month = (d) => `CAST(strftime('%m', ${d}) AS INTEGER)`;
      const truncated = (d, pattern) => `julianday(strftime('${pattern}', ${d}))`;
      const sql = {
        DAY: `CAST(julianday(date(${e})) - julianday(date(${s})) AS INTEGER)`,
        WEEK: `CAST((julianday(date(${e})) - julianday(date(${s}))) / 7 AS INTEGER)`,
        MONTH: `((${year(e)} * 12 + ${month(e)}) - (${year(s)} * 12 + ${month(s)}))`,
        QUARTER: `((${year(e)} * 4 + (${month(e)} + 2) / 3) - (${year(s)} * 4 + (${month(s)} + 2) / 3))`,
        YEAR: `(${year(e)} - ${year(s)})`,
        HOUR: `CAST(round((${truncated(e, '%Y-%m-%d %H:00:00')} - ${truncated(s, '%Y-%m-%d %H:00:00')}) * 24) AS INTEGER)`,
        MINUTE: `CAST(round((${truncated(e, '%Y-%m-%d %H:%M:00')} - ${truncated(s, '%Y-%m-%d %H:%M:00')}) * 1440) AS INTEGER)`,
        SECOND: `CAST(round((julianday(${e}) - julianday(${s})) * 86400) AS INTEGER)`,
      }[interval];
      return { sql, type: 'integer' };
    }
    if (name === 'EOMONTH') {
      arity(2);
      return { sql: `date(${date(0)}, 'start of month', (CAST(${number(1)} AS INTEGER) + 1) || ' months', '-1 day')`, type: 'date' };
    }

    throw badRequest(`${name} isn't supported yet. Supported functions: ${SUPPORTED.join(', ')}.`, node.pos);
  }

  return walk(ast);
}

function compileMeasure(model, measureName, ctx) {
  const measure = findMeasure(model, measureName);
  return { measure, ...compileExpression(model, measure.table, measure.expression, ctx, [measure.name]) };
}

/** Contract type for a formula result: blank reads as a number for measures and as text for columns. */
const resultType = (type, kind) => (type === 'blank' ? (kind === 'column' ? 'text' : 'number') : type);

/**
 * Parses and compiles without running anything; returns positioned errors
 * instead of throwing. kind "column" checks a calculated column (row mode).
 * name, when given, lets self-references be reported as cycles.
 */
function validateExpression(model, table, expression, kind = 'measure', name) {
  try {
    const stack = name ? [kind === 'column' ? `${table}[${name}]` : name] : [];
    const { dependencies, dataType } = compileExpression(model, table, expression, { mode: kind === 'column' ? 'row' : 'measure' }, stack);
    return { ok: true, dependencies, dataType: resultType(dataType, kind) };
  } catch (e) {
    if (e.status !== 400) throw e;
    return { ok: false, error: { error: e.message, position: e.position } };
  }
}

/** Sets each calculated column's dataType from its formula; a broken formula keeps its error for the model browser. */
function inferColumnTypes(model) {
  for (const table of model.tables) {
    for (const col of table.columns) {
      if (!col.expression) continue;
      try {
        col.dataType = resultType(columnExpression(model, table.name, col, makeContext({ mode: 'row' })).type, 'column');
        delete col.expressionError;
      } catch (e) {
        if (e.status !== 400) throw e;
        col.dataType = 'text';
        col.expressionError = e.message;
      }
    }
  }
  return model;
}

module.exports = {
  tokenize,
  parse,
  compileExpression,
  compileMeasure,
  columnSql,
  validateExpression,
  inferColumnTypes,
  SUPPORTED,
  FUNCTION_GROUPS,
};

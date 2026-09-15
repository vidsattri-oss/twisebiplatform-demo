'use strict';

/**
 * DAX-subset measures (spec R5), compiled to SQL on the server so they evaluate
 * per group, in each visual's filter context — unlike the old prototype, which
 * did arithmetic on the client over single, ungrouped numbers.
 *
 * Supported: COUNTROWS(Table), SUM / AVERAGE / MIN / MAX / COUNT / DISTINCTCOUNT(Table[Column]),
 * DIVIDE(a, b[, alternate]), + - * /, unary minus, numeric literals, [Measure] references.
 * Every name is resolved against the model before it reaches SQL (invariant I1).
 */

const { badRequest } = require('./errors');
const { quoteIdent, findMeasure } = require('./model');

const AGGREGATES = { SUM: 'SUM', AVERAGE: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', DISTINCTCOUNT: 'COUNT' };
const NUMERIC_ONLY = new Set(['SUM', 'AVERAGE']);
const SUPPORTED = ['COUNTROWS', ...Object.keys(AGGREGATES), 'DIVIDE'];

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const start = i;
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
      if (src[i] !== "'") throw badRequest("Unclosed quote in a table name.", start);
      i++;
      tokens.push({ type: 'ident', value: name, pos: start });
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      tokens.push({ type: 'ident', value: m[0], pos: start });
      i += m[0].length;
    } else if ('+-*/(),'.includes(ch)) {
      tokens.push({ type: ch, pos: start });
      i++;
    } else {
      throw badRequest(`Unexpected character "${ch}".`, start);
    }
  }
  return tokens;
}

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

  function expression() {
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
    if (t.type === '(') {
      p++;
      const inner = expression();
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
          args.push(expression());
          while (peek() && peek().type === ',') { p++; args.push(expression()); }
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

  const ast = expression();
  if (p < tokens.length) throw badRequest('Unexpected text after the end of the expression.', tokens[p].pos);
  return ast;
}

/**
 * Compiles an expression whose rows come from `homeTable`.
 * ctx.aliasFor(table) -> SQL alias for a table; ctx.highlight -> SQL predicate or null.
 */
function compileExpression(model, homeTable, expression, ctx = {}, stack = []) {
  const aliasFor = ctx.aliasFor || quoteIdent;
  const highlight = ctx.highlight || null;
  const dependencies = new Set();
  const home = model.tables.find((t) => t.name === homeTable);
  if (!home) throw badRequest(`Unknown home table "${homeTable}".`);

  const aggregate = (fn, inner) => (highlight ? `${fn}(CASE WHEN ${highlight} THEN ${inner} END)` : `${fn}(${inner})`);

  function columnSql(node, fnName) {
    if (node.type === 'ref') {
      const col = home.columns.find((c) => c.name === node.name);
      if (!col) throw badRequest(`"${node.name}" is not a column of ${homeTable}. Write ${homeTable}[column].`, node.pos);
      return checkType(col, node, fnName, homeTable);
    }
    if (node.type !== 'column') throw badRequest(`${fnName} needs a column, for example ${fnName}(${homeTable}[column]).`, node.pos);
    if (node.table !== homeTable) {
      throw badRequest(`${fnName} must use the measure's home table "${homeTable}"; cross-table aggregation isn't supported yet.`, node.pos);
    }
    const col = home.columns.find((c) => c.name === node.column);
    if (!col) throw badRequest(`Unknown column "${node.column}" in table "${homeTable}".`, node.pos);
    return checkType(col, node, fnName, homeTable);
  }
  function checkType(col, node, fnName, table) {
    if (NUMERIC_ONLY.has(fnName) && col.dataType !== 'integer' && col.dataType !== 'number') {
      throw badRequest(`${fnName} needs a numeric column; "${col.name}" is ${col.dataType}.`, node.pos);
    }
    return `${aliasFor(table)}.${quoteIdent(col.name)}`;
  }

  function walk(node) {
    switch (node.type) {
      case 'number':
        return String(node.value);
      case 'negate':
        return `(-${walk(node.arg)})`;
      case 'binary': {
        const l = walk(node.left);
        const r = walk(node.right);
        return node.op === '/' ? `(CAST(${l} AS REAL) / NULLIF(${r}, 0))` : `(${l} ${node.op} ${r})`;
      }
      case 'ref': {
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
        return `(${inner.sql})`;
      }
      case 'call': {
        const { name, args } = node;
        if (name === 'COUNTROWS') {
          if (args.length !== 1 || args[0].type !== 'table') throw badRequest('COUNTROWS takes one table, for example COUNTROWS(Table).', node.pos);
          if (args[0].name !== homeTable) {
            throw badRequest(`COUNTROWS must count the measure's home table "${homeTable}".`, args[0].pos);
          }
          return highlight ? `COUNT(CASE WHEN ${highlight} THEN 1 END)` : 'COUNT(*)';
        }
        if (name in AGGREGATES) {
          if (args.length !== 1) throw badRequest(`${name} takes one column.`, node.pos);
          const col = columnSql(args[0], name);
          return name === 'DISTINCTCOUNT'
            ? (highlight ? `COUNT(DISTINCT CASE WHEN ${highlight} THEN ${col} END)` : `COUNT(DISTINCT ${col})`)
            : aggregate(AGGREGATES[name], col);
        }
        if (name === 'DIVIDE') {
          if (args.length < 2 || args.length > 3) throw badRequest('DIVIDE takes a numerator, a denominator and an optional alternate result.', node.pos);
          const [a, b] = [walk(args[0]), walk(args[1])];
          const alt = args[2] ? walk(args[2]) : 'NULL';
          return `(CASE WHEN ${b} IS NULL OR ${b} = 0 THEN ${alt} ELSE CAST(${a} AS REAL) / ${b} END)`;
        }
        throw badRequest(`${name} isn't supported yet. Supported functions: ${SUPPORTED.join(', ')}.`, node.pos);
      }
      case 'column':
        throw badRequest(`${node.table}[${node.column}] must be inside an aggregation such as SUM(${node.table}[${node.column}]).`, node.pos);
      case 'table':
        throw badRequest(`"${node.name}" on its own isn't a value; did you mean COUNTROWS(${node.name})?`, node.pos);
      default:
        throw badRequest('Unsupported expression.', node.pos);
    }
  }

  return { sql: walk(parse(expression)), dependencies: [...dependencies] };
}

function compileMeasure(model, measureName, ctx) {
  const measure = findMeasure(model, measureName);
  return { measure, ...compileExpression(model, measure.table, measure.expression, ctx, [measure.name]) };
}

/** Parses and compiles without running anything; returns positioned errors instead of throwing. */
function validateExpression(model, table, expression) {
  try {
    const { dependencies } = compileExpression(model, table, expression);
    return { ok: true, dependencies };
  } catch (e) {
    if (e.status !== 400) throw e;
    return { ok: false, error: { error: e.message, position: e.position } };
  }
}

module.exports = { tokenize, parse, compileExpression, compileMeasure, validateExpression, SUPPORTED };

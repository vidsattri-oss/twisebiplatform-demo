import { Injectable } from '@angular/core';
import jsep from 'jsep';

/**
 * DAX-like formula editor (item 03) — the real, in-scope slice.
 *
 * Per the feasibility tracker, the hard part of DAX was never the syntax —
 * it's CALCULATE-style filter-context propagation across joined tables,
 * which needs a real semantic layer (Cube.dev or equivalent) and is
 * explicitly out of scope for this local demo (see FormulaModeComponent's
 * placeholder panel for that half).
 *
 * What IS real here: parsing and evaluating simple arithmetic over
 * already-computed measures, e.g. `[Actual Hours] / [Planned Hours]` — via
 * jsep (a real AST parser), never `eval()`/`Function()`, exactly per the
 * OWASP guidance already documented in the tracker for this item.
 */
export interface FormulaEvalResult {
  ok: boolean;
  value?: number;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FormulaService {
  /** Extracts every [Field Name] reference in a formula, in order of appearance. */
  extractReferences(formula: string): string[] {
    const matches = formula.matchAll(/\[([^\]]+)\]/g);
    return Array.from(new Set(Array.from(matches, (m) => m[1])));
  }

  /**
   * Evaluates a formula against a map of measure name -> numeric value.
   * Supports +, -, *, /, parentheses, and [Field] references. Any
   * reference not present in `values` fails closed (does not silently
   * become NaN or 0).
   */
  evaluate(formula: string, values: Record<string, number>): FormulaEvalResult {
    // jsep can't tokenize "[Field Name]" as an identifier, so substitute each
    // bracketed reference with a safe synthetic identifier before parsing,
    // then resolve that identifier back to its real value at eval time.
    const refs = this.extractReferences(formula);
    const idFor = new Map(refs.map((r, i) => [r, `__ref_${i}`]));
    let sanitized = formula;
    for (const [ref, id] of idFor) {
      sanitized = sanitized.split(`[${ref}]`).join(id);
    }

    let ast: jsep.Expression;
    try {
      ast = jsep(sanitized);
    } catch (e) {
      return { ok: false, error: `Could not parse formula: ${(e as Error).message}` };
    }

    const idToRef = new Map(Array.from(idFor, ([ref, id]) => [id, ref]));
    try {
      const value = this.evalNode(ast, idToRef, values);
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return { ok: false, error: 'Formula did not evaluate to a number' };
      }
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private evalNode(node: jsep.Expression, idToRef: Map<string, string>, values: Record<string, number>): number {
    switch (node.type) {
      case 'Literal':
        return Number((node as jsep.Literal).value);
      case 'Identifier': {
        const id = (node as jsep.Identifier).name;
        const ref = idToRef.get(id);
        if (!ref || !(ref in values)) {
          throw new Error(`Unknown measure reference: [${ref ?? id}]`);
        }
        return values[ref];
      }
      case 'BinaryExpression': {
        const b = node as jsep.BinaryExpression;
        const l = this.evalNode(b.left as jsep.Expression, idToRef, values);
        const r = this.evalNode(b.right as jsep.Expression, idToRef, values);
        switch (b.operator) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/': return r === 0 ? NaN : l / r;
          default: throw new Error(`Unsupported operator "${b.operator}"`);
        }
      }
      case 'UnaryExpression': {
        const u = node as jsep.UnaryExpression;
        const arg = this.evalNode(u.argument as jsep.Expression, idToRef, values);
        if (u.operator === '-') return -arg;
        if (u.operator === '+') return arg;
        throw new Error(`Unsupported unary operator "${u.operator}"`);
      }
      default:
        throw new Error(`Unsupported expression type "${node.type}" — only arithmetic over [measures] is supported in this demo`);
    }
  }
}

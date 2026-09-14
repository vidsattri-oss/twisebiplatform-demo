import { FormulaService } from './formula.service';

describe('FormulaService', () => {
  const svc = new FormulaService();

  it('extracts bracketed measure references in order, de-duplicated', () => {
    expect(svc.extractReferences('[Actual Hours] / [Planned Hours] + [Actual Hours]')).toEqual([
      'Actual Hours',
      'Planned Hours',
    ]);
  });

  it('evaluates simple arithmetic over resolved measures', () => {
    const result = svc.evaluate('[Actual] / [Planned]', { Actual: 80, Planned: 100 });
    expect(result.ok).toBeTrue();
    expect(result.value).toBeCloseTo(0.8);
  });

  it('evaluates a literal expression with no references', () => {
    const result = svc.evaluate('(1 + 2) * 3', {});
    expect(result.ok).toBeTrue();
    expect(result.value).toBe(9);
  });

  it('fails closed on an unknown measure reference rather than returning NaN or 0', () => {
    const result = svc.evaluate('[Does Not Exist] * 2', {});
    expect(result.ok).toBeFalse();
    expect(result.error).toContain('Does Not Exist');
  });

  it('never evaluates via eval()/Function() — a call expression is rejected, not executed', () => {
    (globalThis as unknown as { pwned?: boolean }).pwned = false;
    const result = svc.evaluate('(globalThis.pwned = true)', {});
    expect(result.ok).toBeFalse();
    expect((globalThis as unknown as { pwned?: boolean }).pwned).toBeFalse();
  });

  it('rejects division cleanly when the denominator is zero (no throw)', () => {
    const result = svc.evaluate('[A] / [B]', { A: 1, B: 0 });
    expect(result.ok).toBeFalse();
  });
});

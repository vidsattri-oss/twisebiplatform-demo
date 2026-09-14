import { FlattenService } from './flatten.service';

describe('FlattenService', () => {
  const svc = new FlattenService();

  it('flattens a nested object to dotted paths', () => {
    const result = svc.flatten({ a: 1, b: { c: 2, d: { e: 3 } } });
    expect(result).toEqual({ a: 1, 'b.c': 2, 'b.d.e': 3 });
  });

  it('flattens arrays to bracketed indices', () => {
    const result = svc.flatten({ ids: ['x', 'y'] });
    expect(result).toEqual({ 'ids[0]': 'x', 'ids[1]': 'y' });
  });

  it('flattens an array of objects', () => {
    const result = svc.flatten({ approvals: [{ name: 'A', ok: true }, { name: 'B', ok: false }] });
    expect(result).toEqual({
      'approvals[0].name': 'A',
      'approvals[0].ok': true,
      'approvals[1].name': 'B',
      'approvals[1].ok': false,
    });
  });

  it('handles an empty object at the root with a placeholder key, not silently dropping it', () => {
    expect(svc.flatten({})).toEqual({ '(root)': '{}' });
  });

  it('handles an empty array', () => {
    expect(svc.flatten({ items: [] })).toEqual({ items: '[]' });
  });

  it('handles null and undefined leaves', () => {
    expect(svc.flatten({ a: null, b: undefined })).toEqual({ a: null, b: null });
  });

  it('flattenAll unions columns across rows with differing shapes', () => {
    const { columns, rows } = svc.flattenAll([{ a: 1 }, { a: 2, b: 3 }]);
    expect(columns.sort()).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: 1 }, { a: 2, b: 3 }]);
  });
});

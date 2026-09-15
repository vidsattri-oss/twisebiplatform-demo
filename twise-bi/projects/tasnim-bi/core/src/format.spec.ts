import { BLANK_LABEL, formatKey, formatValue } from './format';

describe('formatValue', () => {
  it('applies Power BI number format strings', () => {
    expect(formatValue(1234.567, '#,0')).toBe('1,235');
    expect(formatValue(1234.567, '#,0.0')).toBe('1,234.6');
    expect(formatValue(0.8123, '0.0%')).toBe('81.2%');
    expect(formatValue(1.4, '0%')).toBe('140%');
  });

  it('never guesses percent from magnitude (review finding H6)', () => {
    expect(formatValue(1.4)).toBe('1.40');
    expect(formatValue(1.6)).toBe('1.60');
    expect(formatValue(316)).toBe('316');
  });

  it('formats dates with dd-MM-yyyy by default and honours a format string', () => {
    expect(formatValue('2026-01-15', undefined, 'date')).toBe('15-01-2026');
    expect(formatValue('2026-01-15', 'dd MMM yyyy', 'date')).toBe('15 Jan 2026');
  });

  it('shows blanks and booleans the way Power BI does', () => {
    expect(formatValue(null)).toBe(BLANK_LABEL);
    expect(formatValue('')).toBe(BLANK_LABEL);
    expect(formatValue(true)).toBe('True');
    expect(formatKey(null, 'text')).toBe(BLANK_LABEL);
    expect(formatKey('Marmul ODC', 'text')).toBe('Marmul ODC');
  });
});

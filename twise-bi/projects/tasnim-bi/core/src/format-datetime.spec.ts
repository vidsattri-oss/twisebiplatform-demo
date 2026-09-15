import { formatKey, formatValue, toDateTimeInput } from './format';

describe('date-time formatting', () => {
  it('formats stored date-times with hours and minutes, keeping MM (month) and mm (minutes) apart', () => {
    expect(formatValue('2026-09-14 07:05:09', undefined, 'datetime')).toBe('14-09-2026 07:05');
    expect(formatValue('2026-09-14 07:05:09', 'dd MMM yyyy HH:mm:ss', 'datetime')).toBe('14 Sep 2026 07:05:09');
    expect(formatKey('2026-09-14T23:59:00', 'datetime')).toBe('14-09-2026 23:59');
  });

  it('converts to the datetime-local input form', () => {
    expect(toDateTimeInput('2026-09-14 07:05:09')).toBe('2026-09-14T07:05');
    expect(toDateTimeInput(null)).toBe('');
  });
});

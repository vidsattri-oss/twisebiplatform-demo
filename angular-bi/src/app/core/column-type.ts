export type FieldKind = 'text' | 'number' | 'date';

/**
 * Picks the filter widget a column deserves. SQLite has no real DATE type —
 * dates land as TEXT — so a numeric/text split alone can't tell "close_date"
 * from "owner". Column naming convention (*_date / *date) is the only signal
 * available without sniffing actual row values.
 */
export function classifyColumn(name: string, type: string): FieldKind {
  const t = (type || '').toUpperCase();
  if (t.includes('INT') || t.includes('REAL') || t.includes('NUM') || t.includes('FLOA') || t.includes('DOUB')) return 'number';
  if (/date/i.test(name)) return 'date';
  return 'text';
}

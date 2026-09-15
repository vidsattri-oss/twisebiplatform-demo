import { DataType, Scalar } from './contract';

export const BLANK_LABEL = '(Blank)';

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(decimals: number, grouping: boolean, percent: boolean): Intl.NumberFormat {
  const key = `${decimals}|${grouping}|${percent}`;
  let fmt = numberFormats.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      style: percent ? 'percent' : 'decimal',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    });
    numberFormats.set(key, fmt);
  }
  return fmt;
}

function formatDate(iso: string, format: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) return iso;
  const [, yyyy, month, dd, hh = '00', min = '00', ss = '00'] = m;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Case matters: MM is the month, mm the minutes.
  return format
    .replace('yyyy', yyyy)
    .replace('MMM', months[Number(month) - 1] ?? month)
    .replace('MM', month)
    .replace('dd', dd)
    .replace('HH', hh)
    .replace('mm', min)
    .replace('ss', ss);
}

/**
 * Formats a value the way Power BI format strings read: "#,0" (grouped, no
 * decimals), "#,0.0", "0.0%" (percent), "dd-MM-yyyy" for dates. Blanks read
 * "(Blank)" rather than an empty cell or "null".
 */
export function formatValue(value: Scalar | undefined, format?: string, dataType?: DataType): string {
  if (value === null || value === undefined || value === '') return BLANK_LABEL;
  if (typeof value === 'boolean') return value ? 'True' : 'False';

  if (typeof value === 'number') {
    if (format && /[0#]/.test(format) && !/[dMy]/.test(format)) {
      const decimals = /\.(0+)/.exec(format)?.[1].length ?? 0;
      return numberFormat(decimals, format.includes(','), format.trim().endsWith('%')).format(value);
    }
    return numberFormat(Number.isInteger(value) ? 0 : 2, true, false).format(value);
  }

  if (dataType === 'date' || dataType === 'datetime' || (format && /[dMy]/.test(format))) {
    return formatDate(value, format && /[dMy]/.test(format) ? format : dataType === 'datetime' ? 'dd-MM-yyyy HH:mm' : 'dd-MM-yyyy');
  }
  return value;
}

/** A compact label for a category key: blanks and booleans read like Power BI. */
export function formatKey(value: Scalar | undefined, dataType?: DataType, format?: string): string {
  return formatValue(value, dataType === 'date' || dataType === 'datetime' ? format : undefined, dataType);
}

/** A stored date-time ("2026-09-14 10:30:00") in the form a datetime-local input accepts ("2026-09-14T10:30"). */
export function toDateTimeInput(value: Scalar | undefined): string {
  return typeof value === 'string' ? value.replace(' ', 'T').slice(0, 16) : '';
}

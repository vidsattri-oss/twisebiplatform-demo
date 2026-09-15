import { AdvancedOperator, BiFilter, Column, FieldRef, Scalar, SemanticModel } from './contract';
import { presetLabel } from './filter-actions';
import { formatValue } from './format';

const OPERATORS: Record<AdvancedOperator, string> = {
  eq: 'is',
  ne: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  notContains: "doesn't contain",
  startsWith: 'starts with',
  isBlank: 'is blank',
  isNotBlank: 'is not blank',
};

export function columnOf(model: SemanticModel | null | undefined, ref: FieldRef): Column | undefined {
  return model?.tables.find((t) => t.name === ref.table)?.columns.find((c) => c.name === ref.column);
}

/** One-line, plain-language summary of a filter, e.g. "Plant Description is Marmul ODC". */
export function describeFilter(filter: BiFilter, model?: SemanticModel | null): string {
  const col = columnOf(model, filter.target);
  const show = (v: Scalar | undefined) => formatValue(v ?? null, col?.format, col?.dataType);
  const name = filter.target.column;
  const isDate = col?.dataType === 'date' || col?.dataType === 'datetime';

  switch (filter.kind) {
    case 'basic': {
      if (!filter.values.length) return `${name}: All`;
      const list = filter.values.length <= 3 ? filter.values.map(show).join(', ') : `${filter.values.length} values`;
      return `${name} ${filter.operator === 'in' ? 'is' : 'is not'} ${list}`;
    }
    case 'advanced':
      return `${name} ${filter.conditions
        .map((c) => (c.operator === 'isBlank' || c.operator === 'isNotBlank' ? OPERATORS[c.operator] : `${OPERATORS[c.operator]} ${show(c.value)}`))
        .join(filter.logic === 'or' ? ' or ' : ' and ')}`;
    case 'range': {
      const hasMin = filter.min !== undefined && filter.min !== null;
      const hasMax = filter.max !== undefined && filter.max !== null;
      if (hasMin && hasMax) return `${name} is between ${show(filter.min)} and ${show(filter.max)}`;
      if (hasMin) return `${name} ${isDate ? 'is on or after' : 'is at least'} ${show(filter.min)}`;
      if (hasMax) return `${name} ${isDate ? 'is on or before' : 'is at most'} ${show(filter.max)}`;
      return `${name}: All`;
    }
    case 'relativeDate': {
      const preset = presetLabel(filter);
      if (preset) return `${name} is ${preset === 'Today' || preset === 'Yesterday' ? preset.toLowerCase() : `in the ${preset.toLowerCase()}`}`;
      const span = filter.period === 'this'
        ? `this ${filter.unit}`
        : `the ${filter.period} ${filter.count} ${filter.unit}${filter.count === 1 ? '' : 's'}`;
      return `${name} is in ${span}${filter.period !== 'this' && filter.includeToday === false ? ' (not including today)' : ''}`;
    }
    case 'relativeTime':
      return `${name} is in the ${filter.period} ${filter.count} ${filter.unit}${filter.count === 1 ? '' : 's'}`;
    case 'topN':
      return `${filter.direction === 'top' ? 'Top' : 'Bottom'} ${filter.n} ${name} by ${filter.by}`;
  }
}

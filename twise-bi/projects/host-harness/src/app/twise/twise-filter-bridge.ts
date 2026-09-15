import { Injectable, inject } from '@angular/core';
import { BiFilter, BiFilterBridge, SemanticModel } from '@tasnim/bi';
import { GlobalFiltersService } from './global-filters.service';

/** Which model columns each TWise global filter maps to, in order of preference. */
const PLANT_COLUMNS = ['Plant Description', 'plant', 'plant_description'];
const DATE_COLUMNS = ['Planned Completion Date (Date)', 'task_date', 'created_date'];

function findColumn(model: SemanticModel, names: string[], dataType?: string) {
  for (const name of names) {
    for (const table of model.tables) {
      const column = table.columns.find((c) => c.name === name && (!dataType || c.dataType === dataType));
      if (column) return { table: table.name, column: column.name };
    }
  }
  return null;
}

/**
 * Connects TWise's global filter bar to reports. Only filters whose column
 * exists in the report's model are sent, so an Operations report ignores Plant
 * while the Wells report applies it.
 */
@Injectable()
export class TwiseFilterBridge implements BiFilterBridge {
  private readonly globals = inject(GlobalFiltersService);
  readonly label = 'TWise filter bar';

  filtersFor(model: SemanticModel): BiFilter[] {
    const filters: BiFilter[] = [];
    const plant = this.globals.plant();
    const plantTarget = findColumn(model, PLANT_COLUMNS, 'text');
    if (plant && plantTarget) filters.push({ kind: 'basic', target: plantTarget, operator: 'in', values: [plant], scope: 'report' });

    const from = this.globals.from();
    const to = this.globals.to();
    const dateTarget = findColumn(model, DATE_COLUMNS, 'date');
    if ((from || to) && dateTarget) filters.push({ kind: 'range', target: dateTarget, min: from, max: to, scope: 'report' });
    return filters;
  }
}

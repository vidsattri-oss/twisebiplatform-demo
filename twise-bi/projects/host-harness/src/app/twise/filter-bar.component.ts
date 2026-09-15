import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GlobalFiltersService } from './global-filters.service';

/** TWise's global filter bar, reproduced for the harness. Locked fields show a padlock, as in TWise. */
@Component({
  selector: 'tw-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="bar" aria-label="Global filters" (submit)="$event.preventDefault()">
      <label class="field locked"><span>Country</span><output>{{ f.country }}</output></label>
      <label class="field locked"><span>Sector</span><output>{{ f.sector }}</output></label>
      <label class="field locked"><span>Business Unit</span><output>{{ f.businessUnit }}</output></label>
      <label class="field">
        <span>Plant</span>
        <select [value]="f.plant() ?? ''" (change)="f.plant.set(value($event) || null)">
          <option value="">All</option>
          @for (p of f.plants; track p) {
            <option [value]="p">{{ p }}</option>
          }
        </select>
      </label>
      <label class="field">
        <span>From</span>
        <input type="date" [value]="f.from() ?? ''" (change)="f.from.set(value($event) || null)" />
      </label>
      <label class="field">
        <span>To</span>
        <input type="date" [value]="f.to() ?? ''" (change)="f.to.set(value($event) || null)" />
      </label>
      @if (f.plant() || f.from() || f.to()) {
        <button type="button" class="clear" (click)="f.clear()">Clear</button>
      }
    </form>
  `,
  styleUrl: './filter-bar.component.css',
})
export class FilterBarComponent {
  protected readonly f = inject(GlobalFiltersService);

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

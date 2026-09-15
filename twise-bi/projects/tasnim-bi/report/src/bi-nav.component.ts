import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';

/** Links between the BI pages, resolved against wherever the host mounted BI_ROUTES. */
@Component({
  selector: 'bi-nav',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (base) {
      <nav class="subnav" aria-label="Reports and data">
        <a [routerLink]="['./']" [relativeTo]="base" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Reports</a>
        <a [routerLink]="['data-sources']" [relativeTo]="base" routerLinkActive="active">Data sources</a>
        <a [routerLink]="['json-import']" [relativeTo]="base" routerLinkActive="active">JSON import</a>
        <a [routerLink]="['measures']" [relativeTo]="base" routerLinkActive="active">Formulas</a>
        <a [routerLink]="['visuals']" [relativeTo]="base" routerLinkActive="active">Visuals</a>
      </nav>
    }
  `,
  styleUrls: ['../../styles/page.css'],
})
export class BiNavComponent {
  /** The route BI_ROUTES are mounted under; null when a page is embedded outside the router. */
  protected readonly base = inject(ActivatedRoute, { optional: true })?.parent ?? null;
}

import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { RowsGridComponent } from '../visuals/rows-grid.component';
import { SeeRecordsState } from './report-store';

/** Power BI's "See records": the detail rows behind a data point, under the visual's full filter context. */
@Component({
  selector: 'bi-see-records-sheet',
  imports: [RowsGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="bi-see-records-title">
      <header class="head">
        <div class="titles">
          <p class="eyebrow">See records</p>
          <h2 class="title" id="bi-see-records-title">{{ state().title }}</h2>
          <p class="meta" aria-live="polite">
            @if (error(); as message) {
              <span class="error">{{ message }}</span>
            } @else if (total() !== null) {
              {{ total()!.toLocaleString('en-US') }} rows · every filter on this visual applies
            } @else {
              Loading rows…
            }
          </p>
        </div>
        <button #closeButton type="button" class="btn sm" (click)="closed.emit()">Close</button>
      </header>
      <bi-rows-grid class="grid" [request]="state().request" [columns]="state().columns" (total)="total.set($event)" (failed)="error.set($event)" />
    </aside>
  `,
  styleUrls: ['../styles/tokens.css', '../styles/controls.css'],
  styles: `
    :host { position: fixed; inset: 0; z-index: 1000; display: block; }
    .backdrop { position: absolute; inset: 0; background: rgba(16, 24, 40, 0.35); }
    .sheet {
      position: absolute; top: 0; right: 0; bottom: 0; width: min(960px, 100%); display: flex; flex-direction: column; gap: 12px;
      padding: 16px; box-sizing: border-box; background: var(--bi-surface); box-shadow: var(--bi-shadow-lg);
    }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .titles { min-width: 0; }
    .eyebrow { margin: 0; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--bi-muted); }
    .title { margin: 2px 0; font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
    .meta { margin: 0; font-size: 12.5px; color: var(--bi-muted); font-variant-numeric: tabular-nums; }
    .error { color: var(--bi-danger); }
    .grid { flex: 1; min-height: 0; }
  `,
})
export class SeeRecordsSheetComponent {
  readonly state = input.required<SeeRecordsState>();
  readonly closed = output<void>();
  readonly total = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }
}

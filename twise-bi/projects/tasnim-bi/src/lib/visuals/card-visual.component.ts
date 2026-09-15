import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { measureNames } from '../core/filter-context';
import { BI_VISUAL_CONTEXT } from './visual-context';

/** A single measure value, like Power BI's Card visual. */
@Component({
  selector: 'bi-card-visual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="value" [class.pending]="ctx.loading()">{{ value() }}</div>
    <div class="label">{{ label() }}</div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; justify-content: center; height: 100%; gap: 2px; }
    .value { font-size: clamp(22px, 3vw, 32px); font-weight: 600; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; color: var(--bi-text); }
    .value.pending { opacity: 0.5; }
    .label { font-size: 12px; color: var(--bi-muted); }
  `,
})
export class CardVisualComponent {
  protected readonly ctx = inject(BI_VISUAL_CONTEXT);

  readonly label = computed(() => measureNames(this.ctx.definition())[0] ?? '');
  readonly value = computed(() => {
    const result = this.ctx.result();
    if (!result) return '—';
    const format = this.ctx.model()?.measures.find((m) => m.name === this.label())?.format;
    return this.ctx.format(result.rows[0]?.values[0] ?? null, format);
  });
}

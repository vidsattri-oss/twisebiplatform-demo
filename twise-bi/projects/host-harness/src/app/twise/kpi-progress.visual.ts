import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BI_VISUAL_CONTEXT, BiVisualType, measureNames } from '@tasnim/bi';

/**
 * A custom visual registered by the host with provideBiVisual() — no change to
 * or rebuild of @tasnim/bi. Shows a measure against a target from the visual's
 * options, the way TWise's KPI tiles do.
 */
@Component({
  selector: 'tw-kpi-progress-visual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="value">{{ valueText() }}</div>
    <div class="track" role="progressbar" [attr.aria-valuenow]="percent()" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="label() + ' against target'">
      <div class="fill" [style.width.%]="percent()" [class.met]="percent() >= 100"></div>
    </div>
    <div class="meta">{{ percent() }}% of target {{ targetText() }}</div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; justify-content: center; gap: 6px; height: 100%; }
    .value { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .track { height: 8px; border-radius: 999px; background: #eaecf0; overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; background: var(--bi-accent, #e8822a); transition: width 0.2s ease; }
    .fill.met { background: #17b26a; }
    .meta { font-size: 12px; color: var(--bi-muted, #475467); }
    @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
  `,
})
export class KpiProgressVisualComponent {
  private readonly ctx = inject(BI_VISUAL_CONTEXT);

  readonly label = computed(() => measureNames(this.ctx.definition())[0] ?? '');
  private readonly format = computed(() => this.ctx.model()?.measures.find((m) => m.name === this.label())?.format);
  private readonly value = computed(() => this.ctx.result()?.rows[0]?.values[0] ?? null);
  private readonly target = computed(() => {
    const t = Number(this.ctx.definition().options?.['target']);
    return Number.isFinite(t) && t > 0 ? t : null;
  });

  readonly valueText = computed(() => this.ctx.format(this.value(), this.format()));
  readonly targetText = computed(() => this.ctx.format(this.target(), this.format()));
  readonly percent = computed(() => {
    const value = this.value();
    const target = this.target();
    return value === null || target === null ? 0 : Math.max(0, Math.round((value / target) * 100));
  });
}

export const KPI_PROGRESS_VISUAL: BiVisualType = {
  type: 'kpiProgress',
  label: 'KPI vs target',
  icon: 'M4 17h16M4 17a8 8 0 0 1 16 0M12 17l4-5',
  dataKind: 'aggregate',
  roles: [{ name: 'values', label: 'Value', kind: 'measure', min: 1, max: 1 }],
  defaultInteraction: 'filter',
  loadComponent: () => Promise.resolve(KpiProgressVisualComponent),
};

import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { FormulaService } from '../../core/formula.service';
import { SavedMeasure } from '../../core/models';

/**
 * Formula mode — the real slice of item 03 (DAX-like formula editor).
 *
 * Evaluates arithmetic over already-saved measures, e.g.
 * `[Productivity %] - [Completion %]`. Each referenced measure is re-run
 * WITHOUT its Group By (a single overall scalar, not a per-crew breakdown)
 * — combining grouped series inside a scalar formula is exactly the
 * CALCULATE-style filter-context problem the tracker flags as needing a
 * real semantic layer, which is why that half is the placeholder below
 * rather than something quietly approximated here.
 */
@Component({
  selector: 'app-formula-mode',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './formula-mode.component.html',
  styleUrl: './formula-mode.component.css',
})
export class FormulaModeComponent implements OnChanges {
  @Input({ required: true }) measures: SavedMeasure[] = [];

  private readonly api = inject(ApiService);
  private readonly formulaSvc = inject(FormulaService);

  readonly formula = signal('[Productivity %] - [Completion %]');
  readonly result = signal<{ ok: boolean; value?: number; error?: string } | null>(null);
  readonly evaluating = signal(false);

  readonly examples = [
    { tag: 'SUM', desc: 'Aggregate a saved measure', code: '[Actual Hours]' },
    { tag: 'ARITHMETIC', desc: 'Combine two measures', code: '[Productivity %] - [Completion %]' },
    { tag: 'SCALE', desc: 'Scale a measure', code: '[Actual Hours] * 1.1' },
  ];

  ngOnChanges(): void {
    this.result.set(null);
  }

  useExample(code: string): void {
    this.formula.set(code);
    this.evaluate();
  }

  evaluate(): void {
    const refs = this.formulaSvc.extractReferences(this.formula());
    const missing = refs.filter((r) => !this.measures.some((m) => m.name === r));
    if (missing.length) {
      this.result.set({ ok: false, error: `No saved measure named: ${missing.map((m) => `"${m}"`).join(', ')}` });
      return;
    }
    if (!refs.length) {
      this.result.set(this.formulaSvc.evaluate(this.formula(), {}));
      return;
    }

    this.evaluating.set(true);
    const calls = refs.map((name) => {
      const measure = this.measures.find((m) => m.name === name)!;
      const scalarConfig = { ...measure.config, groupBy: null };
      return this.api.runQuery(scalarConfig);
    });

    forkJoin(calls).subscribe({
      next: (results) => {
        const values: Record<string, number> = {};
        refs.forEach((name, i) => {
          values[name] = results[i].rows[0]?.value ?? NaN;
        });
        this.result.set(this.formulaSvc.evaluate(this.formula(), values));
        this.evaluating.set(false);
      },
      error: () => {
        this.result.set({ ok: false, error: 'Could not resolve one or more measures against the live database.' });
        this.evaluating.set(false);
      },
    });
  }
}

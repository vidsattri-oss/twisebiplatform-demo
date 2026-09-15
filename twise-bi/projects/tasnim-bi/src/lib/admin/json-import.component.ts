import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { IngestResult } from '../core/contract';
import { BI_DATA_SOURCE, describeError } from '../core/data-source';
import { BiNavComponent } from './bi-nav.component';

const MAX_BYTES = 15 * 1024 * 1024;

const SAMPLE = [
  {
    task_code: 'FLAF-2026-0142',
    crew: 'Crew A',
    daily_data: {
      date: '2026-02-11',
      shift: 'Day',
      completed: true,
      employee_ids: ['EMP-1042', 'EMP-1077', 'EMP-1099'],
      metrics: { actual_hours: 9.5, actual_quantity: 74, planned_hours: 8, planned_quantity: 80 },
    },
    approvals: [
      { role: 'Supervisor', name: 'J. Alvarez', approved: true },
      { role: 'QA', name: 'R. Kim', approved: false },
    ],
  },
  {
    task_code: 'MOC-2026-0088',
    crew: 'Crew C',
    daily_data: { date: '2026-02-12', shift: 'Night', completed: false, employee_ids: ['EMP-2003'], metrics: { actual_hours: 6, actual_quantity: 41, planned_hours: 10, planned_quantity: 90 } },
    approvals: [{ role: 'Supervisor', name: 'T. Nakamura', approved: true }],
  },
];

/**
 * Feature 02: JSON into queryable tables with Power Query semantics — nested
 * records become columns, lists become related child tables. Preview first
 * (nothing is written), then import.
 */
@Component({
  selector: 'bi-json-import',
  imports: [BiNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './json-import.component.html',
  styleUrls: ['../styles/tokens.css', '../styles/controls.css', '../styles/page.css', './json-import.component.css'],
})
export class JsonImportComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  protected readonly text = signal('');
  protected readonly tableName = signal('');
  protected readonly connectionId = signal<number | null>(null);
  protected readonly mode = signal<'append' | 'replace'>('append');
  protected readonly parseError = signal<string | null>(null);
  protected readonly requestError = signal<string | null>(null);
  protected readonly preview = signal<IngestResult | null>(null);
  protected readonly imported = signal<IngestResult | null>(null);
  protected readonly busy = signal(false);

  protected readonly models = rxResource({ stream: () => this.ds.listModels() });
  protected readonly targets = computed(() => (this.models.value() ?? []).filter((m) => m.fileName !== 'data.db' && m.status === 'connected'));

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  protected edit(value: string): void {
    this.text.set(value);
    this.preview.set(null);
    this.imported.set(null);
    this.parseError.set(null);
  }

  protected useSample(): void {
    this.edit(JSON.stringify(SAMPLE, null, 2));
    if (!this.tableName()) this.tableName.set('task_events');
  }

  protected onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      this.parseError.set('That file is larger than 15 MB. Split it into smaller files.');
      return;
    }
    file.text().then((content) => {
      this.edit(content);
      if (!this.tableName()) this.tableName.set(file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_'));
    });
  }

  private records(): Record<string, unknown> | Record<string, unknown>[] | null {
    try {
      const parsed: unknown = JSON.parse(this.text());
      const ok = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
      if (ok(parsed) || (Array.isArray(parsed) && parsed.length && parsed.every(ok))) {
        return parsed as Record<string, unknown> | Record<string, unknown>[];
      }
      this.parseError.set('The JSON must be an object or an array of objects.');
    } catch (e) {
      this.parseError.set(`That isn't valid JSON: ${(e as Error).message}`);
    }
    return null;
  }

  protected run(dryRun: boolean): void {
    this.parseError.set(null);
    this.requestError.set(null);
    const records = this.records();
    const tableName = this.tableName().trim();
    if (!records) return;
    if (!tableName) {
      this.parseError.set('Give the table a name.');
      return;
    }
    this.busy.set(true);
    this.ds
      .ingestJson({ tableName, records, mode: this.mode(), dryRun, connectionId: this.connectionId() ?? undefined })
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          if (dryRun) this.preview.set(result);
          else {
            this.imported.set(result);
            this.preview.set(result);
            this.models.reload();
          }
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.requestError.set(describeError(err, 'The import failed.'));
        },
      });
  }

  protected sampleColumns(sample: Record<string, unknown>[]): string[] {
    return [...new Set(sample.flatMap((row) => Object.keys(row)))];
  }

  protected cell(value: unknown): string {
    return value === null || value === undefined ? '(Blank)' : String(value);
  }
}

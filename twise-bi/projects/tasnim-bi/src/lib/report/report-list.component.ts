import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BI_DATA_SOURCE, describeError } from '../core/data-source';
import { BiNavComponent } from '../admin/bi-nav.component';

/** All reports, with create and delete. */
@Component({
  selector: 'bi-report-list',
  imports: [RouterLink, DatePipe, BiNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-list.component.html',
  styleUrls: ['../styles/tokens.css', '../styles/controls.css', '../styles/page.css', './report-list.component.css'],
})
export class ReportListComponent {
  private readonly ds = inject(BI_DATA_SOURCE);
  private readonly router = inject(Router);
  protected readonly base = inject(ActivatedRoute, { optional: true })?.parent ?? null;

  protected readonly data = rxResource({ stream: () => forkJoin({ reports: this.ds.listReports(), models: this.ds.listModels() }) });
  protected readonly loadError = computed(() => (this.data.error() ? describeError(this.data.error(), "Reports couldn't be loaded.") : null));
  protected readonly modelNames = computed(() => new Map((this.data.value()?.models ?? []).map((m) => [m.id, m.name])));

  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly newModelId = signal<number | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly confirmDeleteId = signal<number | null>(null);

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected startCreate(): void {
    this.creating.set(true);
    this.newName.set('');
    this.newModelId.set(this.data.value()?.models.find((m) => m.status === 'connected')?.id ?? null);
  }

  protected create(): void {
    const name = this.newName().trim();
    const modelId = this.newModelId();
    this.actionError.set(null);
    if (!name || modelId === null) {
      this.actionError.set('Give the report a name and choose a data source.');
      return;
    }
    this.ds
      .createReport({ name, modelId, definition: { filters: [], pages: [{ id: 'page-1', name: 'Page 1', filters: [], visuals: [] }] } })
      .subscribe({
        next: (report) => {
          this.creating.set(false);
          if (this.base) this.router.navigate([report.id], { relativeTo: this.base });
          else this.data.reload();
        },
        error: (err: unknown) => this.actionError.set(describeError(err, "The report couldn't be created.")),
      });
  }

  protected remove(id: number): void {
    this.confirmDeleteId.set(null);
    this.ds.deleteReport(id).subscribe({
      next: () => this.data.reload(),
      error: (err: unknown) => this.actionError.set(describeError(err, "The report couldn't be deleted.")),
    });
  }
}

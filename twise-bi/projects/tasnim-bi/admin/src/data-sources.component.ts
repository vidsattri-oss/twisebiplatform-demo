import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { BI_DATA_SOURCE, BiFilter, describeError, describeFilter } from '@tasnim/bi/core';
import { BiNavComponent, FilterEditorComponent } from '@tasnim/bi/report';

const PLANNED_CONNECTORS = [
  { name: 'SQL Server (TWise tenant API)', detail: 'Served by the .NET tenant API implementing the same /api/bi contract.' },
  { name: 'SAP / ERP (OData)', detail: 'Its own connector workstream; lands in the same model shape once built.' },
  { name: 'REST / JSON feeds', detail: 'Today: import JSON on the JSON import page. Scheduled pulls are planned.' },
];

/** Feature 01: connected sources and the semantic model each one exposes — tables, types, relationships, measures. */
@Component({
  selector: 'bi-data-sources',
  imports: [BiNavComponent, FilterEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-sources.component.html',
  styleUrls: ['../../styles/tokens.css', '../../styles/controls.css', '../../styles/page.css', './data-sources.component.css'],
})
export class DataSourcesComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  protected readonly planned = PLANNED_CONNECTORS;
  protected readonly models = rxResource({ stream: () => this.ds.listModels() });
  protected readonly selectedId = signal<number | null>(null);
  protected readonly activeId = computed(() => this.selectedId() ?? this.models.value()?.find((m) => m.status === 'connected')?.id ?? null);
  protected readonly model = rxResource({
    params: () => this.activeId() ?? undefined,
    stream: ({ params }) => this.ds.getModel(params),
  });

  protected readonly adding = signal(false);
  protected readonly files = rxResource({ params: () => (this.adding() ? true : undefined), stream: () => this.ds.availableFiles() });
  protected readonly newName = signal('');
  protected readonly newFile = signal('');
  protected readonly message = signal<{ kind: 'error' | 'success'; text: string } | null>(null);
  protected readonly confirmRemoveId = signal<number | null>(null);
  protected readonly openTable = signal<string | null>(null);

  /** Dataset filters (L1): saved on the model, applied by the server to every query on it. */
  protected readonly datasetFilters = linkedSignal<BiFilter[]>(() => this.model.value()?.datasetFilters ?? []);
  protected readonly addingFilter = signal(false);
  protected readonly savingFilters = signal(false);

  protected readonly listError = computed(() => (this.models.error() ? describeError(this.models.error(), "Data sources couldn't be loaded.") : null));
  protected readonly modelError = computed(() => (this.model.error() ? describeError(this.model.error(), "This model couldn't be loaded.") : null));

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected add(): void {
    const name = this.newName().trim();
    const file = this.newFile() || this.files.value()?.[0] || '';
    if (!name || !file) {
      this.message.set({ kind: 'error', text: 'Name the connection and pick a file.' });
      return;
    }
    this.ds.addConnection(name, file).subscribe({
      next: ({ id }) => {
        this.adding.set(false);
        this.newName.set('');
        this.message.set({ kind: 'success', text: `Connected “${name}”.` });
        this.selectedId.set(id);
        this.models.reload();
      },
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The connection couldn't be added.") }),
    });
  }

  protected describe(filter: BiFilter): string {
    return describeFilter(filter, this.model.value());
  }

  protected addDatasetFilter(filter: BiFilter): void {
    const { scope: _scope, ...unscoped } = filter;
    this.saveDatasetFilters([...this.datasetFilters(), unscoped]);
  }

  protected removeDatasetFilter(index: number): void {
    this.saveDatasetFilters(this.datasetFilters().filter((_, i) => i !== index));
  }

  private saveDatasetFilters(filters: BiFilter[]): void {
    const id = this.activeId();
    if (id === null) return;
    this.savingFilters.set(true);
    this.ds.saveDatasetFilters(id, filters).subscribe({
      next: (saved) => {
        this.savingFilters.set(false);
        this.addingFilter.set(false);
        this.datasetFilters.set(saved);
        this.message.set({ kind: 'success', text: saved.length ? 'Dataset filters saved. Every report on this source now uses them.' : 'Dataset filters removed.' });
      },
      error: (err: unknown) => {
        this.savingFilters.set(false);
        this.message.set({ kind: 'error', text: describeError(err, "The dataset filters couldn't be saved.") });
      },
    });
  }

  protected remove(id: number): void {
    this.confirmRemoveId.set(null);
    this.ds.removeConnection(id).subscribe({
      next: () => {
        if (this.selectedId() === id) this.selectedId.set(null);
        this.message.set({ kind: 'success', text: 'Connection removed.' });
        this.models.reload();
      },
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The connection couldn't be removed.") }),
    });
  }
}

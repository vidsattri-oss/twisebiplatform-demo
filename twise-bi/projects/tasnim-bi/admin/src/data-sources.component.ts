import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  BI_DATA_SOURCE,
  BiFilter,
  ConnectionInput,
  ConnectionType,
  IngestResult,
  ModelSummary,
  describeError,
  describeFilter,
} from '@tasnim/bi/core';
import { BiNavComponent, FilterEditorComponent } from '@tasnim/bi/report';
import { DataSourceSection, readDataSourcesLayout, writeDataSourcesLayout } from './collapsible-layout';

interface FieldSpec {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'checkbox' | 'select';
  placeholder?: string;
  help?: string;
  wide?: boolean;
  options?: { value: string; label: string }[];
  initial?: string | boolean;
}

const TYPE_GROUPS: { label: string; types: ConnectionType[] }[] = [
  { label: 'Files', types: ['sqlite', 'csv', 'excel'] },
  { label: 'Online', types: ['rest', 'googleSheet', 'sap'] },
  { label: 'Databases', types: ['sqlServer', 'postgres'] },
];

const REFRESH: FieldSpec = { key: 'refreshMinutes', label: 'Refresh every (minutes)', kind: 'number', placeholder: '0', help: '0 refreshes only when you choose Refresh now.' };

const databaseFields = (table: string, port: string): FieldSpec[] => [
  { key: 'host', label: 'Host', placeholder: 'appmaster.database.windows.net' },
  { key: 'port', label: 'Port', kind: 'number', placeholder: port },
  { key: 'database', label: 'Database', placeholder: 'AppMasterDB' },
  { key: 'user', label: 'User', placeholder: 'bi_reader' },
  { key: 'tables', label: 'Tables to copy', placeholder: table, wide: true, help: 'schema.table, separated by commas. Each is copied into a table reports can use.' },
  { key: 'maxRows', label: 'Rows per table', kind: 'number', placeholder: '50000' },
  REFRESH,
  { key: 'encrypt', label: 'Encrypt the connection', kind: 'checkbox', initial: true },
  { key: 'trustServerCertificate', label: 'Trust the server certificate', kind: 'checkbox', initial: false },
];

const FIELDS: Partial<Record<ConnectionType, FieldSpec[]>> = {
  rest: [
    { key: 'url', label: 'URL', wide: true, placeholder: 'https://api.example.com/work-orders', help: 'The host must be on the server’s BI_OUTBOUND_ALLOWED_HOSTS list. To try it locally: http://localhost:4173/api/bi/samples/work-orders.json' },
    { key: 'recordsPath', label: 'Records path', placeholder: 'data.items', help: 'Where the list is in the response. Leave empty for a list or a value / data / items envelope.' },
    { key: 'tableName', label: 'Table name', placeholder: 'work_orders' },
    REFRESH,
  ],
  googleSheet: [
    { key: 'url', label: 'Share or publish link', wide: true, placeholder: 'https://docs.google.com/spreadsheets/d/…/edit#gid=0', help: 'Share with “Anyone with the link”, or publish to the web. Drive file links work too.' },
    { key: 'format', label: 'File format', kind: 'select', initial: 'csv', options: [{ value: 'csv', label: 'CSV (one sheet)' }, { value: 'xlsx', label: 'Excel (every sheet)' }, { value: 'json', label: 'JSON file' }] },
    { key: 'tableName', label: 'Table name', placeholder: 'sheet' },
    REFRESH,
  ],
  sap: [
    { key: 'serviceUrl', label: 'OData service URL', wide: true, placeholder: 'https://erp.example.com/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV' },
    { key: 'entitySet', label: 'Entity set', placeholder: 'A_PurchaseOrder' },
    { key: 'user', label: 'User', placeholder: 'BI_READER' },
    { key: 'top', label: 'Rows to read', kind: 'number', placeholder: '5000' },
    REFRESH,
  ],
  sqlServer: databaseFields('dbo.task_daily, dbo.task_data', '1433'),
  postgres: databaseFields('public.work_orders', '5432'),
};

const SECRET_LABELS: Partial<Record<ConnectionType, string>> = { rest: 'Bearer token (optional)', sap: 'Password', sqlServer: 'Password', postgres: 'Password' };
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Feature 01: data sources. Typed connections — SQLite files, CSV and Excel
 * uploads, REST APIs, Google Sheets / Drive links, SAP OData, SQL Server and
 * PostgreSQL — each becoming a semantic model with typed columns,
 * relationships, measures and dataset filters.
 */
@Component({
  selector: 'bi-data-sources',
  imports: [BiNavComponent, FilterEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-sources.component.html',
  styleUrls: ['../../styles/tokens.css', '../../styles/controls.css', '../../styles/page.css', './data-sources.component.css'],
})
export class DataSourcesComponent {
  private readonly ds = inject(BI_DATA_SOURCE);

  protected readonly typeGroups = TYPE_GROUPS;
  protected readonly models = rxResource({ stream: () => this.ds.listModels() });
  protected readonly types = rxResource({ stream: () => this.ds.connectionTypes() });
  protected readonly typeInfo = computed(() => new Map((this.types.value() ?? []).map((t) => [t.type, t])));
  protected readonly selectedId = signal<number | null>(null);
  protected readonly activeId = computed(() => this.selectedId() ?? this.models.value()?.find((m) => m.status === 'connected')?.id ?? null);
  protected readonly model = rxResource({
    params: () => this.activeId() ?? undefined,
    stream: ({ params }) => this.ds.getModel(params),
  });

  protected readonly adding = signal(false);
  protected readonly files = rxResource({ params: () => (this.adding() ? true : undefined), stream: () => this.ds.availableFiles() });
  protected readonly newType = signal<ConnectionType>('sqlite');
  protected readonly newName = signal('');
  protected readonly newFile = signal('');
  protected readonly newSecret = signal('');
  protected readonly fieldValues = signal<Record<string, string | boolean>>({});
  protected readonly uploadFile = signal<File | null>(null);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<number | null>(null);
  protected readonly message = signal<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  protected readonly confirmRemoveId = signal<number | null>(null);
  protected readonly openTable = signal<string | null>(null);

  /** D1: collapsed Connections rail and open sections, remembered per browser. */
  protected readonly layout = signal(readDataSourcesLayout());
  protected readonly allOpen = computed(() => Object.values(this.layout().open).every(Boolean));

  constructor() {
    effect(() => writeDataSourcesLayout(this.layout()));
  }

  protected toggleSection(section: DataSourceSection): void {
    this.layout.update((l) => ({ ...l, open: { ...l.open, [section]: !l.open[section] } }));
  }

  protected setAllSections(open: boolean): void {
    this.layout.update((l) => ({ ...l, open: { tables: open, datasetFilters: open, relationships: open, measures: open } }));
  }

  protected toggleConnections(): void {
    this.layout.update((l) => ({ ...l, connectionsCollapsed: !l.connectionsCollapsed }));
  }

  protected readonly fields = computed(() => FIELDS[this.newType()] ?? []);
  protected readonly secretLabel = computed(() => SECRET_LABELS[this.newType()] ?? null);
  protected readonly driverNote = computed(() => {
    const info = this.typeInfo().get(this.newType());
    return info?.kind === 'database' && info.driverInstalled === false
      ? `The BI server doesn't have the "${info.driver}" package yet, so this connection will show “Needs ${info.system}” until it is installed. The settings are saved now.`
      : null;
  });

  /** Dataset filters (L1): saved on the model, applied by the server to every query on it. */
  protected readonly datasetFilters = linkedSignal<BiFilter[]>(() => this.model.value()?.datasetFilters ?? []);
  protected readonly addingFilter = signal(false);
  protected readonly savingFilters = signal(false);

  protected readonly listError = computed(() => (this.models.error() ? describeError(this.models.error(), "Data sources couldn't be loaded.") : null));
  protected readonly modelError = computed(() => (this.model.error() ? describeError(this.model.error(), "This model couldn't be loaded.") : null));

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected chooseType(type: ConnectionType): void {
    this.newType.set(type);
    this.fieldValues.set({});
    this.newSecret.set('');
    this.uploadFile.set(null);
  }

  protected fieldValue(field: FieldSpec): string | boolean {
    return this.fieldValues()[field.key] ?? field.initial ?? '';
  }

  protected setField(key: string, value: string | boolean): void {
    this.fieldValues.update((v) => ({ ...v, [key]: value }));
  }

  protected chooseFile(event: Event): void {
    this.uploadFile.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  protected stateBadge(m: ModelSummary): { cls: string; text: string } {
    if (m.status === 'error') return { cls: 'danger', text: 'Error' };
    switch (m.state) {
      case 'needs-setup': return { cls: 'warning', text: 'Needs setup' };
      case 'needs-refresh': return { cls: 'warning', text: 'Not refreshed yet' };
      case 'needs-upload': return { cls: 'warning', text: 'Upload a file' };
      case 'refresh-failed': return { cls: 'danger', text: 'Refresh failed' };
      default: return { cls: 'success', text: 'Ready' };
    }
  }

  protected when(iso: string): string {
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (minutes < 1) return 'refreshed just now';
    if (minutes < 60) return `refreshed ${minutes} min ago`;
    if (minutes < 48 * 60) return `refreshed ${Math.round(minutes / 60)} h ago`;
    return `refreshed ${new Date(iso).toLocaleDateString('en-GB')}`;
  }

  private settingsFromForm(type: ConnectionType): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const f of FIELDS[type] ?? []) {
      const value = this.fieldValue(f);
      if (f.kind === 'checkbox') settings[f.key] = value === true;
      else if (f.kind === 'number') settings[f.key] = value === '' ? undefined : Number(value);
      else if (value !== '') settings[f.key] = value;
    }
    return settings;
  }

  protected add(): void {
    const name = this.newName().trim();
    const type = this.newType();
    const file = this.uploadFile();
    this.message.set(null);
    if (!name) return this.message.set({ kind: 'error', text: 'Name the connection.' });
    const input: ConnectionInput = { name, type };
    if (type === 'sqlite') {
      input.fileName = this.newFile() || this.files.value()?.[0];
      if (!input.fileName) return this.message.set({ kind: 'error', text: 'Pick one of the files on the server.' });
    }
    if ((type === 'csv' || type === 'excel') && !file) return this.message.set({ kind: 'error', text: `Choose the ${type === 'csv' ? 'CSV file' : 'workbook'} to upload.` });
    if (FIELDS[type]) input.settings = this.settingsFromForm(type);
    if (this.newSecret()) input.secret = this.newSecret();

    this.saving.set(true);
    this.ds.addConnection(input).subscribe({
      next: ({ id }) => {
        this.saving.set(false);
        this.newSecret.set('');
        this.adding.set(false);
        this.newName.set('');
        this.fieldValues.set({});
        this.selectedId.set(id);
        this.models.reload();
        if (file && (type === 'csv' || type === 'excel')) this.upload(id, type, file);
        else this.message.set({ kind: 'success', text: `Added “${name}”.${this.kindOf(type) === 'pull' || this.kindOf(type) === 'database' ? ' Choose Test, then Refresh now to load its data.' : ''}` });
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.message.set({ kind: 'error', text: describeError(err, "The connection couldn't be added.") });
      },
    });
  }

  private kindOf(type: ConnectionType) {
    return this.typeInfo().get(type)?.kind;
  }

  protected onUpload(m: ModelSummary, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file && (m.type === 'csv' || m.type === 'excel')) this.upload(m.id, m.type, file);
  }

  private async upload(connectionId: number, type: 'csv' | 'excel', file: File): Promise<void> {
    if (file.size > MAX_UPLOAD_BYTES) {
      this.message.set({ kind: 'error', text: 'Files up to 10 MB can be uploaded here.' });
      return;
    }
    this.busyId.set(connectionId);
    const tableName = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_') || 'upload';
    let request: Observable<IngestResult>;
    try {
      request = type === 'csv'
        ? this.ds.uploadCsv({ connectionId, tableName, csv: await file.text() })
        : this.ds.uploadExcel({ connectionId, fileName: file.name, fileBase64: toBase64(await file.arrayBuffer()) });
    } catch {
      this.busyId.set(null);
      this.message.set({ kind: 'error', text: "The file couldn't be read." });
      return;
    }
    request.subscribe({
      next: (result) => {
        this.busyId.set(null);
        const loaded = result.tables.filter((t) => !t.parent).map((t) => `${t.name} (${t.rowCount.toLocaleString('en-US')} rows)`);
        this.message.set({ kind: 'success', text: `Loaded ${loaded.join(', ')} from ${file.name}.` });
        this.selectedId.set(connectionId);
        this.models.reload();
        this.model.reload();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.message.set({ kind: 'error', text: describeError(err, "The file couldn't be loaded.") });
      },
    });
  }

  protected test(id: number): void {
    this.busyId.set(id);
    this.ds.testConnection(id).subscribe({
      next: (r) => {
        this.busyId.set(null);
        this.message.set({ kind: r.ok ? 'success' : 'info', text: r.message });
        this.models.reload();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.message.set({ kind: 'error', text: describeError(err, "The connection couldn't be tested.") });
      },
    });
  }

  protected refresh(id: number): void {
    this.busyId.set(id);
    this.ds.refreshConnection(id).subscribe({
      next: (r) => {
        this.busyId.set(null);
        this.message.set({ kind: 'success', text: `Refreshed: ${r.rows.toLocaleString('en-US')} rows into ${r.tables.join(', ')}.${r.empty.length ? ` Empty: ${r.empty.join(', ')}.` : ''}` });
        this.selectedId.set(id);
        this.models.reload();
        this.model.reload();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.message.set({ kind: 'error', text: describeError(err, "The connection couldn't be refreshed.") });
        this.models.reload();
      },
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

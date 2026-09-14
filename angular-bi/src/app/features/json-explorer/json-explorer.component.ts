import { Component, OnInit, inject, signal } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { FlattenService } from '../../core/flatten.service';
import { ConnectionInfo, FlatRow, RawEvent } from '../../core/models';

type SourceMode = 'events' | 'table' | 'upload';

@Component({
  selector: 'app-json-explorer',
  standalone: true,
  imports: [SlicePipe, FormsModule],
  templateUrl: './json-explorer.component.html',
  styleUrl: './json-explorer.component.css',
})
export class JsonExplorerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly flattenSvc = inject(FlattenService);

  readonly sourceMode = signal<SourceMode>('events');
  readonly error = signal<string | null>(null);

  // Seeded raw events
  readonly events = signal<RawEvent[]>([]);
  readonly selectedId = signal<number | null>(null);

  // Connected-DB table source
  readonly connections = signal<ConnectionInfo[]>([]);
  readonly tableConnectionId = signal(1);
  readonly tableName = signal('');
  readonly tableRows = signal<Record<string, unknown>[]>([]);

  // File upload source
  readonly uploadFileName = signal<string | null>(null);
  readonly uploadRows = signal<Record<string, unknown>[]>([]);
  readonly uploadError = signal<string | null>(null);

  // Shared flatten/ingest result
  readonly flattened = signal<{ columns: string[]; rows: FlatRow[] } | null>(null);
  readonly ingestTableName = signal('');
  readonly ingestConnectionId = signal(1);
  readonly ingestStatus = signal<string | null>(null);
  readonly ingestError = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getRawEvents().subscribe({
      next: (res) => {
        this.events.set(res.events);
        if (res.events.length) this.selectEvent(res.events[0].id);
      },
      error: () => this.error.set('Could not reach the local backend. Run "npm start" in query-builder-prototype/.'),
    });
    this.api.getConnections().subscribe((res) => {
      this.connections.set(res.connections);
      const firstTable = res.connections[0]?.tables[0]?.name;
      if (firstTable) this.tableName.set(firstTable);
    });
  }

  setMode(mode: SourceMode): void {
    this.sourceMode.set(mode);
    this.flattened.set(null);
  }

  // --- Seeded events ---
  selectEvent(id: number): void {
    this.selectedId.set(id);
    this.flattened.set(null);
  }

  selectedEvent(): RawEvent | undefined {
    return this.events().find((e) => e.id === this.selectedId());
  }

  prettyJson(): string {
    const ev = this.selectedEvent();
    return ev ? JSON.stringify(ev.payload, null, 2) : '';
  }

  flattenSelectedEvent(): void {
    const ev = this.selectedEvent();
    if (!ev) return;
    this.flattened.set(this.flattenSvc.flattenAll([ev.payload]));
    this.ingestTableName.set(ev.source.toLowerCase());
  }

  // --- Connected-DB table source ---
  currentTablesForPicker(): { name: string }[] {
    return this.connections().find((c) => c.id === this.tableConnectionId())?.tables ?? [];
  }

  onTableConnectionChange(): void {
    this.tableName.set(this.currentTablesForPicker()[0]?.name ?? '');
  }

  loadTableRows(): void {
    if (!this.tableName()) return;
    this.api.getTablePreview(this.tableConnectionId(), this.tableName()).subscribe((res) => {
      this.tableRows.set(res.rows);
    });
  }

  flattenTableRows(): void {
    if (!this.tableRows().length) return;
    this.flattened.set(this.flattenSvc.flattenAll(this.tableRows()));
    this.ingestTableName.set(`${this.tableName()}_copy`);
  }

  // --- File upload source ---
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadError.set(null);
    this.uploadFileName.set(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      try {
        const rows = file.name.toLowerCase().endsWith('.csv') ? this.parseCsv(text) : this.parseJson(text);
        this.uploadRows.set(rows);
      } catch (e) {
        this.uploadError.set((e as Error).message);
        this.uploadRows.set([]);
      }
    };
    reader.onerror = () => this.uploadError.set('Could not read the file.');
    reader.readAsText(file);
  }

  private parseJson(text: string): Record<string, unknown>[] {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  /** Deliberately simple: comma-split, no quoted-field handling — fine for a demo file, not a general CSV parser. */
  private parseCsv(text: string): Record<string, unknown>[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) throw new Error('CSV needs a header row plus at least one data row.');
    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = cells[i]?.trim() ?? null; });
      return row;
    });
  }

  flattenUpload(): void {
    if (!this.uploadRows().length) return;
    this.flattened.set(this.flattenSvc.flattenAll(this.uploadRows()));
    const base = (this.uploadFileName() ?? 'upload').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    this.ingestTableName.set(base);
  }

  // --- Ingestion: flattened rows -> a real queryable table ---
  ingest(): void {
    const f = this.flattened();
    const name = this.ingestTableName().trim();
    if (!f || !name) return;
    this.ingestError.set(null);
    this.api.ingest(this.ingestConnectionId(), name, f.rows).subscribe({
      next: (res) => this.ingestStatus.set(`Loaded ${res.rowCount} row(s) into "${res.table}" — it's now a real table in Data Sources / Query Builder.`),
      error: (err) => this.ingestError.set(err?.error?.error ?? 'Ingestion failed'),
    });
  }
}

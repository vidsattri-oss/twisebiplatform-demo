import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ConnectionInfo } from '../../core/models';

interface PlaceholderSource {
  name: string;
  driver: string;
  note: string;
}

@Component({
  selector: 'app-data-sources',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './data-sources.component.html',
  styleUrl: './data-sources.component.css',
})
export class DataSourcesComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly connections = signal<ConnectionInfo[]>([]);
  readonly error = signal<string | null>(null);
  readonly openTables = signal<Set<string>>(new Set()); // keyed "connId:table"
  readonly previews = signal<Record<string, Record<string, unknown>[]>>({});
  readonly testStatus = signal<Record<number, 'idle' | 'testing' | 'ok'>>({});

  readonly showAddForm = signal(false);
  readonly availableFiles = signal<string[]>([]);
  readonly newConnName = signal('');
  readonly newConnFile = signal('');
  readonly newConnSecret = signal('');
  readonly addError = signal<string | null>(null);
  readonly adding = signal(false);

  readonly placeholders: PlaceholderSource[] = [
    { name: 'SQL Server / AppMasterDB', driver: 'mssql (via BFF)', note: 'Connector design documented in the feasibility tracker — not wired in this demo.' },
    { name: 'SAP / ERP', driver: 'OData / RFC', note: 'Scoped as its own workstream (SAP Basis dependency) — see tracker for the connector plan.' },
    { name: 'Google Sheets / Drive', driver: 'googleapis (OAuth2)', note: 'Polling adapter documented; not connected in this demo.' },
    { name: 'REST API / JSON files', driver: 'HTTP polling adapter', note: 'Same pattern as the JSON Explorer, generalized to a scheduled pull.' },
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.getConnections().subscribe({
      next: (res) => this.connections.set(res.connections),
      error: () => this.error.set('Could not reach the local backend. Run "npm start" in query-builder-prototype/.'),
    });
  }

  key(connId: number, table: string): string {
    return `${connId}:${table}`;
  }

  toggle(connId: number, table: string): void {
    const k = this.key(connId, table);
    const next = new Set(this.openTables());
    if (next.has(k)) {
      next.delete(k);
    } else {
      next.add(k);
      if (!this.previews()[k]) {
        this.api.getTablePreview(connId, table).subscribe((res) => {
          this.previews.update((p) => ({ ...p, [k]: res.rows }));
        });
      }
    }
    this.openTables.set(next);
  }

  previewColumns(connId: number, table: string): string[] {
    const rows = this.previews()[this.key(connId, table)];
    return rows && rows.length ? Object.keys(rows[0]) : [];
  }

  testConnection(connId: number): void {
    this.testStatus.update((s) => ({ ...s, [connId]: 'testing' }));
    this.api.getConnections().subscribe({
      next: () => {
        this.testStatus.update((s) => ({ ...s, [connId]: 'ok' }));
        setTimeout(() => this.testStatus.update((s) => ({ ...s, [connId]: 'idle' })), 1500);
      },
      error: () => this.testStatus.update((s) => ({ ...s, [connId]: 'idle' })),
    });
  }

  openAddForm(): void {
    this.addError.set(null);
    this.newConnName.set('');
    this.newConnFile.set('');
    this.newConnSecret.set('');
    this.api.getAvailableFiles().subscribe((res) => {
      this.availableFiles.set(res.files);
      this.newConnFile.set(res.files[0] ?? '');
    });
    this.showAddForm.set(true);
  }

  cancelAdd(): void {
    this.showAddForm.set(false);
  }

  submitAdd(): void {
    const name = this.newConnName().trim();
    const fileName = this.newConnFile();
    if (!name || !fileName) {
      this.addError.set('Give the connection a name and pick a detected file.');
      return;
    }
    this.adding.set(true);
    this.api.addConnection(name, fileName, this.newConnSecret().trim() || undefined).subscribe({
      next: () => {
        this.adding.set(false);
        this.showAddForm.set(false);
        this.load();
      },
      error: (err) => {
        this.adding.set(false);
        this.addError.set(err?.error?.error ?? 'Could not add the connection.');
      },
    });
  }

  removeConnection(id: number): void {
    this.api.deleteConnection(id).subscribe(() => this.load());
  }
}

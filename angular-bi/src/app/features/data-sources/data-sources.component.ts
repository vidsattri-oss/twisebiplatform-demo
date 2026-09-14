import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { SourceInfo } from '../../core/models';

interface PlaceholderSource {
  name: string;
  driver: string;
  note: string;
}

@Component({
  selector: 'app-data-sources',
  standalone: true,
  templateUrl: './data-sources.component.html',
  styleUrl: './data-sources.component.css',
})
export class DataSourcesComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly source = signal<SourceInfo | null>(null);
  readonly error = signal<string | null>(null);
  readonly openTables = signal<Set<string>>(new Set());
  readonly previews = signal<Record<string, Record<string, unknown>[]>>({});
  readonly testStatus = signal<'idle' | 'testing' | 'ok'>('idle');

  readonly placeholders: PlaceholderSource[] = [
    { name: 'SQL Server / AppMasterDB', driver: 'mssql (via BFF)', note: 'Connector design documented in the feasibility tracker — not wired in this demo.' },
    { name: 'SAP / ERP', driver: 'OData / RFC', note: 'Scoped as its own workstream (SAP Basis dependency) — see tracker for the connector plan.' },
    { name: 'Google Sheets / Drive', driver: 'googleapis (OAuth2)', note: 'Polling adapter documented; not connected in this demo.' },
    { name: 'REST API / JSON files', driver: 'HTTP polling adapter', note: 'Same pattern as the JSON Explorer below, generalized to a scheduled pull.' },
  ];

  ngOnInit(): void {
    this.api.getSources().subscribe({
      next: (s) => this.source.set(s),
      error: () => this.error.set('Could not reach the local backend. Run "npm start" in query-builder-prototype/.'),
    });
  }

  toggle(table: string): void {
    const next = new Set(this.openTables());
    if (next.has(table)) {
      next.delete(table);
    } else {
      next.add(table);
      if (!this.previews()[table]) {
        this.api.getTablePreview(table).subscribe((res) => {
          this.previews.update((p) => ({ ...p, [table]: res.rows }));
        });
      }
    }
    this.openTables.set(next);
  }

  previewColumns(table: string): string[] {
    const rows = this.previews()[table];
    return rows && rows.length ? Object.keys(rows[0]) : [];
  }

  testConnection(): void {
    this.testStatus.set('testing');
    this.api.getSources().subscribe({
      next: () => {
        this.testStatus.set('ok');
        setTimeout(() => this.testStatus.set('idle'), 1500);
      },
      error: () => this.testStatus.set('idle'),
    });
  }
}

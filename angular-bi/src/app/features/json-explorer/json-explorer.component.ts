import { Component, OnInit, inject, signal } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { FlattenService } from '../../core/flatten.service';
import { FlatRow, RawEvent } from '../../core/models';

@Component({
  selector: 'app-json-explorer',
  standalone: true,
  imports: [SlicePipe],
  templateUrl: './json-explorer.component.html',
  styleUrl: './json-explorer.component.css',
})
export class JsonExplorerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly flattenSvc = inject(FlattenService);

  readonly events = signal<RawEvent[]>([]);
  readonly selectedId = signal<number | null>(null);
  readonly flattened = signal<{ columns: string[]; rows: FlatRow[] } | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getRawEvents().subscribe({
      next: (res) => {
        this.events.set(res.events);
        if (res.events.length) this.select(res.events[0].id);
      },
      error: () => this.error.set('Could not reach the local backend. Run "npm start" in query-builder-prototype/.'),
    });
  }

  select(id: number): void {
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

  flattenSelected(): void {
    const ev = this.selectedEvent();
    if (!ev) return;
    this.flattened.set(this.flattenSvc.flattenAll([ev.payload]));
  }
}

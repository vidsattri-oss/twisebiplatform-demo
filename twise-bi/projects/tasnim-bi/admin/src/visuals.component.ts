import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { BI_DATA_SOURCE, BiVisualType, PluginManifest, PluginVisuals, VisualRegistry, describeError } from '@tasnim/bi/core';
import { BiNavComponent } from '@tasnim/bi/report';

/**
 * Feature 04: the visuals marketplace (V2). Built-in visuals, visuals the host
 * app registers, and plug-ins — installed from the bundled catalog or imported
 * as a manifest plus one JavaScript file. Installed plug-ins appear in the
 * Visualizations pane straight away and run sandboxed (V3, I8).
 */
@Component({
  selector: 'bi-visuals',
  imports: [BiNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visuals.component.html',
  styleUrls: ['../../styles/tokens.css', '../../styles/controls.css', '../../styles/page.css', './visuals.component.css'],
})
export class VisualsComponent {
  private readonly ds = inject(BI_DATA_SOURCE);
  private readonly registry = inject(VisualRegistry);
  private readonly plugins = inject(PluginVisuals);

  protected readonly catalog = rxResource({ stream: () => this.ds.pluginCatalog() });
  protected readonly installed = computed(() => this.registry.all());
  protected readonly manifestText = signal('');
  protected readonly codeText = signal('');
  protected readonly busy = signal<string | null>(null);
  protected readonly message = signal<{ kind: 'error' | 'success'; text: string } | null>(null);
  protected readonly confirmRemove = signal<string | null>(null);
  protected readonly catalogError = computed(() => (this.catalog.error() ? describeError(this.catalog.error(), "The catalog couldn't be loaded.") : null));

  constructor() {
    void this.plugins.ensureLoaded();
  }

  protected origin(t: BiVisualType): { text: string; cls: string } {
    if (t.origin === 'plugin') return { text: t.plugin?.source === 'catalog' ? 'Plug-in · catalog' : 'Plug-in · imported', cls: 'accent' };
    if (t.origin === 'built-in') return { text: 'Built-in', cls: '' };
    return { text: 'Added by the host app', cls: 'primary' };
  }

  protected roleSummary(t: { roles: { label: string; min: number; max: number }[] }): string {
    return t.roles.map((r) => `${r.label} (${r.min === r.max ? r.max : `${r.min}–${r.max}`})`).join(' · ');
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected onFile(event: Event, target: 'manifest' | 'code'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 256 * 1024) {
      this.message.set({ kind: 'error', text: `${file.name} is larger than 256 KB.` });
      return;
    }
    void file.text().then((content) => (target === 'manifest' ? this.manifestText : this.codeText).set(content));
  }

  protected install(type: string): void {
    this.busy.set(type);
    this.message.set(null);
    this.ds.installCatalogPlugin(type).subscribe({
      next: (plugin) => {
        void this.plugins.reload().then(() => {
          this.busy.set(null);
          this.catalog.reload();
          this.message.set({ kind: 'success', text: `Installed ${plugin.label}. Add it from the Visualizations pane when you edit a report.` });
        });
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.message.set({ kind: 'error', text: describeError(err, "The visual couldn't be installed.") });
      },
    });
  }

  /** Fills the import form with a catalog sample under a new type, as a starting point for a custom visual. */
  protected startFrom(type: string): void {
    this.ds.catalogPlugin(type).subscribe({
      next: ({ manifest, code }) => {
        const copy: PluginManifest = { ...manifest, type: `${manifest.type}-custom`, label: `${manifest.label} (custom)`, author: undefined };
        this.manifestText.set(JSON.stringify(copy, null, 2));
        this.codeText.set(code);
        this.message.set({ kind: 'success', text: `Loaded the ${manifest.label} sample into the import form. Change it, then choose Import visual.` });
      },
      error: (err: unknown) => this.message.set({ kind: 'error', text: describeError(err, "The sample couldn't be loaded.") }),
    });
  }

  protected importVisual(): void {
    this.message.set(null);
    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(this.manifestText()) as PluginManifest;
    } catch (e) {
      this.message.set({ kind: 'error', text: `The manifest isn't valid JSON: ${(e as Error).message}` });
      return;
    }
    this.busy.set('import');
    this.ds.importPlugin({ manifest, code: this.codeText() }).subscribe({
      next: (plugin) => {
        void this.plugins.reload().then(() => {
          this.busy.set(null);
          this.manifestText.set('');
          this.codeText.set('');
          this.message.set({ kind: 'success', text: `Imported ${plugin.label}. Add it from the Visualizations pane when you edit a report.` });
        });
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.message.set({ kind: 'error', text: describeError(err, "The visual couldn't be imported.") });
      },
    });
  }

  protected remove(type: string): void {
    this.confirmRemove.set(null);
    this.busy.set(type);
    this.ds.removePlugin(type).subscribe({
      next: () => {
        void this.plugins.reload().then(() => {
          this.busy.set(null);
          this.catalog.reload();
          this.message.set({ kind: 'success', text: 'Visual removed. Reports that used it show it as unavailable.' });
        });
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.message.set({ kind: 'error', text: describeError(err, "The visual couldn't be removed.") });
      },
    });
  }
}

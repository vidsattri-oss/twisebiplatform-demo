import { Injectable, InjectionToken, Type, inject } from '@angular/core';
import { defer, firstValueFrom } from 'rxjs';
import { PluginVisual } from './contract';
import { BI_DATA_SOURCE } from './data-source';
import { BiVisualType, VisualRegistry } from './visual-registry';

/** Loads the sandboxed plug-in host component. provideBi() supplies it from @tasnim/bi/visuals. */
export const BI_PLUGIN_COMPONENT = new InjectionToken<() => Promise<Type<unknown>>>('BI_PLUGIN_COMPONENT');

/** A registry entry for an installed plug-in. Plug-ins draw query results, so they are aggregate visuals. */
export function pluginVisualType(plugin: PluginVisual, loadComponent: (() => Promise<Type<unknown>>) | null): BiVisualType {
  return {
    type: plugin.type,
    label: plugin.label,
    icon: plugin.icon,
    description: plugin.description,
    dataKind: 'aggregate',
    defaultInteraction: 'highlight',
    origin: 'plugin',
    plugin: { source: plugin.source, version: plugin.version, author: plugin.author },
    roles: plugin.roles.map((r) => ({ ...r })),
    loadComponent: loadComponent ?? (() => Promise.reject(new Error('Plug-in visuals need provideBi() from @tasnim/bi.'))),
  };
}

/** Puts the installed plug-ins into the visual registry: once on first use, and again after installing or removing one. */
@Injectable({ providedIn: 'root' })
export class PluginVisuals {
  private readonly ds = inject(BI_DATA_SOURCE);
  private readonly registry = inject(VisualRegistry);
  private readonly loadComponent = inject(BI_PLUGIN_COMPONENT, { optional: true });
  private loading: Promise<void> | null = null;

  ensureLoaded(): Promise<void> {
    return this.loading ?? this.reload();
  }

  reload(): Promise<void> {
    this.loading = firstValueFrom(defer(() => this.ds.listPlugins()))
      .then((list) => this.registry.setPlugins(list.map((p) => pluginVisualType(p, this.loadComponent))))
      // A backend without plug-in support simply has none; try again next time.
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }
}

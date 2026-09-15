import { Injectable, InjectionToken, Provider, Type, inject, signal } from '@angular/core';
import { VisualInteraction } from './contract';

/**
 * How a visual gets its data from the report:
 * - aggregate: the report runs a VisualQuery (category roles grouped, value roles measured)
 *   and passes the result, including highlights;
 * - rows: the visual pages detail rows itself through BiVisualContext.rows();
 * - slicer: the visual loads values and publishes a filter through setSlicerFilter().
 */
export type VisualDataKind = 'aggregate' | 'rows' | 'slicer';

export interface DataRole {
  name: string;
  label: string;
  kind: 'grouping' | 'measure';
  min: number;
  max: number;
}

/** A registry entry — the equivalent of a Power BI visual's capabilities. */
export interface BiVisualType {
  type: string;
  label: string;
  /** SVG path data (24×24 viewBox) for the Visualizations pane. */
  icon: string;
  dataKind: VisualDataKind;
  roles: DataRole[];
  /** What another visual's selection does to this one unless the report says otherwise. */
  defaultInteraction: VisualInteraction;
  loadComponent: () => Promise<Type<unknown>>;
  /** built-in: ships with @tasnim/bi; host: registered by the host app; plugin: installed at runtime. Unset means host. */
  origin?: 'built-in' | 'host' | 'plugin';
  description?: string;
  plugin?: { source: 'catalog' | 'imported'; version?: string; author?: string };
}

export const BI_VISUALS = new InjectionToken<BiVisualType[]>('BI_VISUALS');

/** Registers a visual type. Hosts call it to add custom visuals without rebuilding the library. */
export function provideBiVisual(visual: BiVisualType): Provider {
  return { provide: BI_VISUALS, useValue: visual, multi: true };
}

@Injectable({ providedIn: 'root' })
export class VisualRegistry {
  private readonly byType = new Map<string, BiVisualType>();
  /** Plug-ins installed at runtime (V2). A signal, so panes and visuals update when one is installed. */
  private readonly plugins = signal<readonly BiVisualType[]>([]);

  constructor() {
    // Later registrations win, so a host can replace a built-in by type.
    for (const visual of inject(BI_VISUALS, { optional: true }) ?? []) this.byType.set(visual.type, visual);
  }

  get(type: string): BiVisualType | undefined {
    return this.byType.get(type) ?? this.plugins().find((p) => p.type === type);
  }

  /** Built-in and host visuals first; a plug-in never replaces a visual the app registered. */
  all(): BiVisualType[] {
    return [...this.byType.values(), ...this.plugins().filter((p) => !this.byType.has(p.type))];
  }

  setPlugins(visuals: readonly BiVisualType[]): void {
    this.plugins.set(visuals);
  }

  interactionFor(targetType: string): VisualInteraction {
    const target = this.get(targetType);
    if (!target) return 'none';
    return target.dataKind === 'aggregate' ? target.defaultInteraction : target.defaultInteraction === 'none' ? 'none' : 'filter';
  }
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BiFilter, DateLevel, GroupField, RoleItem, VisualDefinition, VisualInteraction, VisualLayout, clampLayout, describeFilter, isMeasureItem } from '@tasnim/bi/core';
import { columnOf } from '@tasnim/bi/core';
import { DataRole, VisualRegistry } from '@tasnim/bi/core';
import { ReportStore } from '@tasnim/bi/core';

/**
 * Power BI's Visualizations pane: choose a visual type, fill its data-role
 * wells from the model, set format and layout, and decide how its selection
 * affects the other visuals on the page.
 */
@Component({
  selector: 'bi-visualizations-pane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visualizations-pane.component.html',
  styleUrls: ['../../styles/controls.css', './visualizations-pane.component.css'],
})
export class VisualizationsPaneComponent {
  protected readonly store = inject(ReportStore);
  protected readonly registry = inject(VisualRegistry);

  /** Computed, so a plug-in installed while the report is open appears without a reload. */
  protected readonly types = computed(() => this.registry.all());
  protected readonly visual = this.store.focusedVisual;
  protected readonly type = computed(() => {
    const v = this.visual();
    return v ? this.registry.get(v.type) : undefined;
  });
  protected readonly model = this.store.model;
  protected readonly slicerModes = [
    { value: '', label: 'Automatic' },
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'list', label: 'List' },
    { value: 'between', label: 'Between' },
    { value: 'relativeDate', label: 'Relative date' },
    { value: 'relativeTime', label: 'Relative time' },
    { value: 'boolean', label: 'True / False toggle' },
  ];
  protected readonly slicerDefaultText = computed(() => {
    const d = this.visual()?.options?.['defaultFilter'] as BiFilter | undefined;
    return d ? describeFilter(d, this.model()) : 'None — the slicer opens showing all values.';
  });
  protected readonly isChart = computed(() => ['column', 'bar', 'line', 'pie', 'donut'].includes(this.visual()?.type ?? ''));
  protected readonly others = computed(() => (this.store.page()?.visuals ?? []).filter((v) => v.id !== this.visual()?.id));

  protected readonly columnsByTable = computed(() =>
    (this.model()?.tables ?? []).filter((t) => !t.hidden).map((t) => ({ table: t.name, columns: t.columns.filter((c) => !c.hidden) })),
  );
  protected readonly measuresByTable = computed(() => {
    const groups = new Map<string, string[]>();
    for (const m of this.model()?.measures ?? []) groups.set(m.table, [...(groups.get(m.table) ?? []), m.name]);
    return [...groups.entries()].map(([table, measures]) => ({ table, measures }));
  });

  protected items(role: DataRole): RoleItem[] {
    return this.visual()?.roles[role.name] ?? [];
  }

  protected itemLabel(item: RoleItem): string {
    return isMeasureItem(item) ? item.measure : `${item.table} · ${item.column}`;
  }

  protected isDateField(item: RoleItem): item is GroupField {
    const type = !isMeasureItem(item) ? columnOf(this.model(), item)?.dataType : undefined;
    return type === 'date' || type === 'datetime';
  }

  protected dateLevel(item: RoleItem): string {
    return !isMeasureItem(item) ? (item.dateLevel ?? '') : '';
  }

  private setRole(role: DataRole, fn: (items: RoleItem[]) => RoleItem[]): void {
    const v = this.visual();
    if (!v) return;
    this.store.updateVisual(v.id, (current) => ({ ...current, roles: { ...current.roles, [role.name]: fn(current.roles[role.name] ?? []).slice(0, role.max) } }));
  }

  protected addItem(role: DataRole, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const [kind, a, b] = select.value.split('\u0000');
    select.value = '';
    if (kind === 'm' && a) this.setRole(role, (items) => [...items, { measure: a }]);
    if (kind === 'c' && a && b) this.setRole(role, (items) => [...items, { table: a, column: b }]);
  }

  protected removeItem(role: DataRole, index: number): void {
    this.setRole(role, (items) => items.filter((_, i) => i !== index));
  }

  protected moveItem(role: DataRole, index: number, delta: number): void {
    this.setRole(role, (items) => {
      const next = [...items];
      const target = index + delta;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  protected setDateLevel(role: DataRole, index: number, level: string): void {
    this.setRole(role, (items) =>
      items.map((item, i) => {
        if (i !== index || isMeasureItem(item)) return item;
        const { dateLevel: _old, ...field } = item;
        return level ? { ...field, dateLevel: level as DateLevel } : field;
      }),
    );
  }

  protected columnKey(table: string, column: string): string {
    return `c\u0000${table}\u0000${column}`;
  }

  protected measureKey(name: string): string {
    return `m\u0000${name}`;
  }

  protected setTitle(event: Event): void {
    const v = this.visual();
    if (v) this.store.updateVisual(v.id, { title: (event.target as HTMLInputElement).value });
  }

  protected option(name: string): unknown {
    return this.visual()?.options?.[name];
  }

  protected setOption(name: string, value: unknown): void {
    const v = this.visual();
    if (!v) return;
    this.store.updateVisual(v.id, (current) => ({ ...current, options: { ...(current.options ?? {}), [name]: value } }));
  }

  protected setLayout(key: keyof VisualLayout, event: Event): void {
    const v = this.visual();
    if (!v) return;
    const raw = Number((event.target as HTMLInputElement).value);
    // clampLayout keeps column + width inside the 12-column grid whichever field changed.
    this.store.updateVisual(v.id, (current) => ({ ...current, layout: clampLayout({ ...(current.layout ?? { x: 0, y: 0, w: 6, h: 6 }), [key]: raw }) }));
  }

  protected interaction(target: VisualDefinition): VisualInteraction {
    const v = this.visual();
    return v ? this.store.interactionFor(v, target) : 'none';
  }

  protected canHighlight(target: VisualDefinition): boolean {
    return this.registry.get(target.type)?.dataKind === 'aggregate';
  }

  protected setInteraction(target: VisualDefinition, event: Event): void {
    const v = this.visual();
    if (v) this.store.setInteraction(v.id, target.id, (event.target as HTMLSelectElement).value as VisualInteraction);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}

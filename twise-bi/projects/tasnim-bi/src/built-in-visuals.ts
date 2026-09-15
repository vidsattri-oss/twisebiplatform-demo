import { BiVisualType, DataRole } from '@tasnim/bi/core';

const values = (label: string, max: number): DataRole => ({ name: 'values', label, kind: 'measure', min: 1, max });
const category = (label: string): DataRole => ({ name: 'category', label, kind: 'grouping', min: 1, max: 1 });
const chart = () => import('@tasnim/bi/visuals').then((m) => m.ChartVisualComponent);

const VISUALS: BiVisualType[] = [
  { type: 'column', label: 'Column chart', icon: 'M6 20V11M12 20V5M18 20v-6M3 20h18', dataKind: 'aggregate', roles: [category('X-axis'), values('Y-axis', 5)], defaultInteraction: 'highlight', loadComponent: chart },
  { type: 'bar', label: 'Bar chart', icon: 'M4 3v18M4 7h9M4 12h16M4 17h6', dataKind: 'aggregate', roles: [category('Y-axis'), values('X-axis', 5)], defaultInteraction: 'highlight', loadComponent: chart },
  { type: 'line', label: 'Line chart', icon: 'M3 17l5-5 4 3 9-9M3 21h18', dataKind: 'aggregate', roles: [category('X-axis'), values('Y-axis', 5)], defaultInteraction: 'highlight', loadComponent: chart },
  { type: 'pie', label: 'Pie chart', icon: 'M12 3a9 9 0 1 0 9 9h-9V3Z', dataKind: 'aggregate', roles: [category('Legend'), values('Values', 1)], defaultInteraction: 'highlight', loadComponent: chart },
  { type: 'donut', label: 'Donut chart', icon: 'M12 3a9 9 0 1 0 9 9h-5a4 4 0 1 1-4-4V3Z', dataKind: 'aggregate', roles: [category('Legend'), values('Values', 1)], defaultInteraction: 'highlight', loadComponent: chart },
  {
    type: 'card', label: 'Card', icon: 'M4 6h16v12H4zM8 14h5M8 10h8', dataKind: 'aggregate', roles: [values('Fields', 1)], defaultInteraction: 'filter',
    loadComponent: () => import('@tasnim/bi/visuals').then((m) => m.CardVisualComponent),
  },
  {
    type: 'table', label: 'Table', icon: 'M4 5h16v14H4zM4 10h16M10 5v14', dataKind: 'rows', roles: [{ name: 'columns', label: 'Columns', kind: 'grouping', min: 1, max: 30 }], defaultInteraction: 'filter',
    loadComponent: () => import('@tasnim/bi/visuals').then((m) => m.TableVisualComponent),
  },
  {
    type: 'slicer', label: 'Slicer', icon: 'M4 6h16M7 12h10M10 18h4', dataKind: 'slicer', roles: [{ name: 'field', label: 'Field', kind: 'grouping', min: 1, max: 1 }], defaultInteraction: 'filter',
    loadComponent: () => import('@tasnim/bi/visuals').then((m) => m.SlicerVisualComponent),
  },
];

/** The visuals every host gets from provideBi(). Icons are 24×24 stroke paths. */
export const BUILT_IN_VISUALS: BiVisualType[] = VISUALS.map((visual) => ({ ...visual, origin: 'built-in' }));

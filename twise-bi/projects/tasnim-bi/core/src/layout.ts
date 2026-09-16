import { VisualLayout } from './contract';

export const GRID_COLUMNS = 12;
export const GRID_ROW_HEIGHT = 40;
export const GRID_GAP = 12;

/**
 * Keeps a visual inside the 12-column grid: width 1–12, and the column moved
 * left when column + width would pass the right edge (otherwise CSS grid adds
 * implicit columns and squeezes every other visual).
 */
export function clampLayout(layout: Partial<VisualLayout> | undefined): VisualLayout {
  const whole = (v: number | undefined, fallback: number) => (Number.isFinite(v) ? Math.round(v as number) : fallback);
  const w = Math.min(Math.max(whole(layout?.w, 6), 1), GRID_COLUMNS);
  const x = Math.min(Math.max(whole(layout?.x, 0), 0), GRID_COLUMNS - w);
  return { x, y: Math.max(whole(layout?.y, 0), 0), w, h: Math.max(whole(layout?.h, 6), 1) };
}

function overlaps(a: VisualLayout, b: VisualLayout): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Snaps a dropped visual to the nearest open grid slot. The report remains a
 * 12-column CSS grid, while this helper prevents a drop from creating an
 * implicit column or leaving two magnetic blocks on top of each other.
 */
export function magneticLayout(layout: Partial<VisualLayout> | undefined, occupied: Partial<VisualLayout>[] = []): VisualLayout {
  const desired = clampLayout(layout);
  const taken = occupied.map(clampLayout);
  if (!taken.some((other) => overlaps(desired, other))) return desired;

  const maxRow = Math.max(desired.y + taken.length + 12, ...taken.map((other) => other.y + other.h + desired.h));
  let best: VisualLayout | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y <= maxRow; y += 1) {
    for (let x = 0; x <= GRID_COLUMNS - desired.w; x += 1) {
      const candidate = { ...desired, x, y };
      if (taken.some((other) => overlaps(candidate, other))) continue;
      // Keep a dropped block on the same row when possible; moving down is a
      // larger visual jump than sliding into the next open column.
      const distance = Math.abs(x - desired.x) + Math.abs(y - desired.y) * 2;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best ?? desired;
}

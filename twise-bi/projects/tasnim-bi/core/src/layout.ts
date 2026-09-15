import { VisualLayout } from './contract';

export const GRID_COLUMNS = 12;

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

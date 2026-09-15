import { clampLayout } from './layout';

// Regression (QA 2026-09-15): Column 8 + Width 12 produced grid-column 9 / span 12 and broke the canvas.
describe('clampLayout', () => {
  it('moves a visual left so column + width never passes 12', () => {
    expect(clampLayout({ x: 8, y: 2, w: 12, h: 6 })).toEqual({ x: 0, y: 2, w: 12, h: 6 });
    expect(clampLayout({ x: 10, y: 0, w: 4, h: 3 })).toEqual({ x: 8, y: 0, w: 4, h: 3 });
  });

  it('keeps valid layouts unchanged and fills missing or invalid values', () => {
    expect(clampLayout({ x: 3, y: 4, w: 6, h: 8 })).toEqual({ x: 3, y: 4, w: 6, h: 8 });
    expect(clampLayout(undefined)).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    expect(clampLayout({ x: -2, y: -1, w: 40, h: 0 })).toEqual({ x: 0, y: 0, w: 12, h: 1 });
    expect(clampLayout({ x: Number.NaN, w: 2.6 })).toEqual({ x: 0, y: 0, w: 3, h: 6 });
  });
});

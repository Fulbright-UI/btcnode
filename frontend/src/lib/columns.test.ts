import { describe, expect, it } from 'vitest';
import { COLUMN_CHART, curvePoints, layoutColumns, skeletonColumns, tierOf } from './columns';

describe('layoutColumns', () => {
  it('draws columns in the order of their values, inside the box, without overlap', () => {
    const values = [1, 5, 3, 8, 2];
    const rects = layoutColumns(values);
    expect(rects).toHaveLength(5);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(COLUMN_CHART.width + 0.01);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height).toBeCloseTo(COLUMN_CHART.height, 5);
    }
    for (let i = 1; i < rects.length; i++)
      expect(rects[i]!.x).toBeGreaterThanOrEqual(rects[i - 1]!.x + rects[i - 1]!.width);
    const heights = rects.map((r) => r.height);
    expect(heights[3]).toBe(Math.max(...heights));
    expect(heights[0]).toBe(Math.min(...heights));
  });

  it('never draws a zero bar as nothing, and honours a fixed scale', () => {
    const rects = layoutColumns([30, 60, 90], { floor: 30, ceiling: 90 });
    expect(rects[0]!.height).toBe(0.8);
    expect(rects[2]!.height).toBeCloseTo(COLUMN_CHART.height);
    expect(rects[1]!.height).toBeCloseTo(COLUMN_CHART.height / 2);
  });

  it('needs at least two values', () => {
    expect(layoutColumns([1])).toEqual([]);
  });
});

describe('tiers and skeletons', () => {
  it('sorts fees into three tiers', () => {
    expect(tierOf(2, [2, 5])).toBe(1);
    expect(tierOf(5, [2, 5])).toBe(2);
    expect(tierOf(5.1, [2, 5])).toBe(3);
  });
  it('gives the skeleton 24 stubs inside the box', () => {
    const s = skeletonColumns();
    expect(s).toHaveLength(24);
    expect(s[23]!.x + s[23]!.width).toBeLessThanOrEqual(COLUMN_CHART.width + 0.01);
  });
  it('maps a curve onto the box with the peak at the top margin', () => {
    const pts = curvePoints([1, 2, 4], 600, 120).split(' ');
    expect(pts).toHaveLength(3);
    expect(pts[0]).toBe('0.0,90.0');
    expect(pts[2]).toBe('600.0,18.0');
  });
});

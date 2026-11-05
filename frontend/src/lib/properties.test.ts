import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COLUMN_CHART, curvePoints, layoutColumns, tierOf } from './columns';
import { gridColumns } from './grid';
import { shortenAddress } from './networkMap';

const finite = fc.double({ min: -1e12, max: 1e12, noNaN: true });

describe('chart and layout helpers hold for any input', () => {
  it('layoutColumns stays inside the chart and never draws a zero bar', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1e9, noNaN: true }), { minLength: 2, maxLength: 96 }),
        (values) => {
          const cols = layoutColumns(values);
          expect(cols).toHaveLength(values.length);
          for (const c of cols) {
            expect(c.height).toBeGreaterThanOrEqual(0.8);
            expect(c.height).toBeLessThanOrEqual(COLUMN_CHART.height + 1e-9);
            expect(c.x + c.width).toBeLessThanOrEqual(COLUMN_CHART.width + 1e-6);
          }
        },
      ),
    );
  });

  it('tierOf is 1, 2 or 3 and never falls as the value rises', () => {
    fc.assert(
      fc.property(finite, finite, finite, finite, (a, b, v, w) => {
        const limits = [Math.min(a, b), Math.max(a, b)] as const;
        const [lo, hi] = v <= w ? [v, w] : [w, v];
        expect([1, 2, 3]).toContain(tierOf(lo, limits));
        expect(tierOf(lo, limits)).toBeLessThanOrEqual(tierOf(hi, limits));
      }),
    );
  });

  it('curvePoints gives one point per value inside the box', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1e9, noNaN: true }), { minLength: 2, maxLength: 200 }),
        (values) => {
          const points = curvePoints(values, 300, 60).split(' ');
          expect(points).toHaveLength(values.length);
          for (const p of points) {
            const [x, y] = p.split(',').map(Number);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(300);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(60);
          }
        },
      ),
    );
  });

  it('gridColumns leaves fewer holes than any other choice', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 500 }), (count) => {
        const holes = (cols: number) => (cols - (count % cols)) % cols;
        const cols = gridColumns(count);
        expect([2, 3, 4]).toContain(cols);
        for (const other of [2, 3, 4]) expect(holes(cols)).toBeLessThanOrEqual(holes(other));
      }),
    );
  });

  it('shortenAddress keeps short addresses and caps long ones at 26 characters', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (address) => {
        const short = shortenAddress(address);
        if (address.length <= 28) expect(short).toBe(address);
        else {
          expect(short).toHaveLength(26);
          expect(address.startsWith(short.slice(0, 12))).toBe(true);
          expect(address.endsWith(short.slice(-13))).toBe(true);
        }
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { gridColumns } from './grid';

describe('gridColumns', () => {
  it('uses one column per card for one or two cards, and at least one', () => {
    expect(gridColumns(0)).toBe(1);
    expect(gridColumns(1)).toBe(1);
    expect(gridColumns(2)).toBe(2);
  });

  it('prefers the widest layout that fills the last row', () => {
    expect(gridColumns(4)).toBe(4);
    expect(gridColumns(6)).toBe(3);
    expect(gridColumns(10)).toBe(2);
    expect(gridColumns(7)).toBe(4);
  });
});

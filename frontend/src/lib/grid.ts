/**
 * Pick a column count that leaves the last row of cards as full as possible:
 * six cards in four columns leave two holes, in three columns none.
 */
export function gridColumns(count: number): number {
  if (count <= 2) return Math.max(1, count);
  let best = 4;
  let fewest = 99;
  for (const cols of [4, 3, 2]) {
    const remaining = (cols - (count % cols)) % cols;
    if (remaining < fewest) {
      best = cols;
      fewest = remaining;
    }
  }
  return best;
}

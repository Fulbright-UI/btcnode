export interface ColumnRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const COLUMN_CHART = { width: 260, height: 38 } as const;

/**
 * Column geometry for the small 24-hour bars. The scale starts at `floor`
 * (0 unless told otherwise) and ends at the largest value or `ceiling`; a
 * fixed 30–90 °C scale keeps a calm day looking calm. A value is never drawn
 * below 0.8 units — a zero bar would vanish and read as "no data".
 */
export function layoutColumns(
  values: number[],
  opts: { floor?: number; ceiling?: number; width?: number; height?: number } = {},
): ColumnRect[] {
  const width = opts.width ?? COLUMN_CHART.width;
  const height = opts.height ?? COLUMN_CHART.height;
  const floor = opts.floor ?? 0;
  if (values.length < 2) return [];
  const top = (opts.ceiling ?? Math.max(...values)) - floor || 1;
  const count = values.length;
  const gap = (COLUMN_CHART.width / count) * 0.18;
  const column = (width - (count - 1) * gap) / count;
  return values.map((v, i) => {
    const h = Math.max(0.8, ((v - floor) / top) * height);
    return { x: i * (column + gap), y: height - h, width: column, height: h };
  });
}

/** Skeleton columns: 24 muted stubs where a chart will later appear. */
export function skeletonColumns(
  width: number = COLUMN_CHART.width,
  height: number = COLUMN_CHART.height,
): ColumnRect[] {
  const count = 24;
  const gap = (width / count) * 0.22;
  const bar = (width - (count - 1) * gap) / count;
  return Array.from({ length: count }, (_, i) => ({
    x: i * (bar + gap),
    y: height * 0.55,
    width: bar,
    height: height * 0.45,
  }));
}

/** Which of three tiers a value falls into: up to the first limit, up to the second, above. */
export function tierOf(value: number, limits: readonly [number, number]): 1 | 2 | 3 {
  if (value <= limits[0]) return 1;
  if (value <= limits[1]) return 2;
  return 3;
}

/** Polyline points for a curve across `width`×`height`, top and bottom margins as fractions. */
export function curvePoints(
  values: number[],
  width: number,
  height: number,
  top = 0.15,
  bottom = 0.05,
): string {
  if (values.length < 2) return '';
  const hi = Math.max(...values) || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height * top + (1 - v / hi) * height * (1 - top - bottom);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

import type { Peer } from '@btcnode/shared';

/** Drawing constants of the fan — the same numbers as the original page. */
export const MAP = {
  rowHeight: 30,
  marginTop: 34,
  /** peers per side the frame always holds (16 in all) */
  rowsMin: 8,
  /** "127.0.0.1:35824 · Tor · inbound · 547 ms · 44.0 KB" */
  charsMin: 50,
  /** must match .peer-label in the stylesheet */
  font: 12.5,
  charWidth: 0.63,
  /** distance from hub to the inner end of the spoke */
  spoke: 104,
  logoRadius: 19,
  dotRadius: 4.5,
} as const;

export interface PeerRow {
  index: number;
  peer: Peer;
  right: boolean;
  y: number;
  xInner: number;
  xOuter: number;
  xText: number;
  anchor: 'start' | 'end';
  hubX: number;
  label: string;
}

export interface MapGeometry {
  width: number;
  height: number;
  hub: { x: number; y: number };
  rows: PeerRow[];
}

/** Onion addresses are 62 characters — too long for any label. */
export function shortenAddress(address: string): string {
  if (address.length <= 28) return address;
  return `${address.slice(0, 12)}…${address.slice(-13)}`;
}

/**
 * A fan: our own node in the middle, the peers to the left and right, split
 * evenly (left first when odd), both sides centred in a frame that never
 * shrinks below `rowsMin` rows and `charsMin` characters — before the fixed
 * frame, every peer that came or went changed the height of the whole left
 * column. Beyond the frame the map still grows. The width follows the
 * longest label: an SVG clips beyond its viewBox.
 */
export function layoutNetworkMap(peers: Peer[], labelOf: (p: Peer) => string): MapGeometry | null {
  if (!peers.length) return null;
  const labels = peers.map(labelOf);
  const split = Math.ceil(peers.length / 2);
  const half = Math.max(split, MAP.rowsMin);
  const height = MAP.marginTop * 2 + half * MAP.rowHeight;
  const offset = { left: (half - split) / 2, right: (half - (peers.length - split)) / 2 };

  const longest = Math.max(...labels.map((l) => l.length), MAP.charsMin);
  const labelWidth = longest * MAP.font * MAP.charWidth;
  const halfWidth = MAP.spoke + 14 + labelWidth + 26;
  const width = Math.round(halfWidth * 2);
  const mx = width / 2;
  const my = height / 2;
  const leftInner = mx - MAP.spoke;
  const rightInner = mx + MAP.spoke;

  const rows = peers.map((peer, i): PeerRow => {
    const right = i >= split;
    const row = (right ? i - split : i) + (right ? offset.right : offset.left);
    const y = MAP.marginTop + row * MAP.rowHeight + MAP.rowHeight / 2;
    return right
      ? {
          index: i,
          peer,
          right,
          y,
          xInner: rightInner,
          xOuter: width - 26,
          xText: rightInner + 14,
          anchor: 'start',
          hubX: mx + MAP.logoRadius + 5,
          label: labels[i]!,
        }
      : {
          index: i,
          peer,
          right,
          y,
          xInner: leftInner,
          xOuter: 26,
          xText: leftInner - 14,
          anchor: 'end',
          hubX: mx - MAP.logoRadius - 5,
          label: labels[i]!,
        };
  });
  return { width, height, hub: { x: mx, y: my }, rows };
}

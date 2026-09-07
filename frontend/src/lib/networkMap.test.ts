import type { Peer } from '@btcnode/shared';
import { describe, expect, it } from 'vitest';
import { MAP, layoutNetworkMap, shortenAddress } from './networkMap';

function peer(id: number, address = `10.0.0.${id}:8333`): Peer {
  return {
    id,
    address,
    network: 'ipv4',
    inbound: id % 2 === 0,
    latencyMs: 50,
    currentPingMs: 60,
    connectedFor: 100,
    userAgent: 'x',
    services: [],
    bytesSent: 0,
    bytesReceived: 0,
    addressesFrom: 0,
    addressesDropped: 0,
    blocksFrom: 0,
    lastBlockFromAt: null,
    blocksTo: 0,
    lastBlockToAt: null,
    announcedTip: false,
  };
}

describe('network map geometry', () => {
  it('splits peers evenly, left first when odd, centred in a fixed frame', () => {
    const g = layoutNetworkMap([peer(1), peer(2), peer(3)], (p) => p.address)!;
    expect(g.rows.filter((r) => !r.right)).toHaveLength(2);
    expect(g.rows.filter((r) => r.right)).toHaveLength(1);
    expect(g.height).toBe(MAP.marginTop * 2 + MAP.rowsMin * MAP.rowHeight);
    // both sides centred: the single right peer sits at the vertical middle
    expect(g.rows[2]!.y).toBeCloseTo(g.hub.y);
    // hub in the middle, the two sides equally far from it
    expect(g.hub.x).toBeCloseTo(g.width / 2);
    expect(g.hub.x - g.rows[0]!.xInner).toBeCloseTo(g.rows[2]!.xInner - g.hub.x);
  });

  it('grows beyond the frame and widens with the longest label', () => {
    const many = Array.from({ length: 30 }, (_, i) => peer(i));
    const g = layoutNetworkMap(many, (p) => p.address)!;
    expect(g.height).toBe(MAP.marginTop * 2 + 15 * MAP.rowHeight);
    const long = layoutNetworkMap(many, () => 'x'.repeat(80))!;
    expect(long.width).toBeGreaterThan(g.width);
    for (const r of long.rows) {
      expect(r.y).toBeGreaterThan(0);
      expect(r.y).toBeLessThan(long.height);
    }
  });

  it('returns null without peers', () => {
    expect(layoutNetworkMap([], (p) => p.address)).toBeNull();
  });

  it('shortens onion addresses only', () => {
    expect(shortenAddress('203.0.113.9:8333')).toBe('203.0.113.9:8333');
    const onion = 'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghzw.onion:8333';
    expect(shortenAddress(onion)).toBe('abcdefghijab…zw.onion:8333');
  });
});

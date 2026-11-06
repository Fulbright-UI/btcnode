import type { NetworkKind } from '@btcnode/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { peer, snapshot } from '@/test/snapshot';
import { peerSummary } from './peers';

describe('peerSummary', () => {
  it('counts peers, inbound ones and networks, largest network first', () => {
    const s = peerSummary([
      peer({ id: 1, network: 'ipv4' }),
      peer({ id: 2, network: 'onion', inbound: true }),
      peer({ id: 3, network: 'ipv4', inbound: true }),
      peer({ id: 4, network: 'ipv4' }),
      peer({ id: 5, network: 'onion' }),
      peer({ id: 6, network: 'i2p' }),
    ]);
    expect(s.total).toBe(6);
    expect(s.inbound).toBe(2);
    expect(s.byNetwork).toEqual([
      ['ipv4', 3],
      ['onion', 2],
      ['i2p', 1],
    ]);
  });

  it('leaves our own Electrum server out of the latency figures', () => {
    const s = peerSummary(snapshot().peers.list);
    expect(s.total).toBe(4);
    expect(s.byNetwork.map(([k]) => k)).toContain('electrs');
    expect(s.averageLatency).toBe(40);
    expect(s.fastest).toBe(40);
    // the onion and i2p peers answer in 42 ms, the ipv6 one in 80
    expect(s.latency.map((l) => [l.network, l.medianMs])).toEqual(
      expect.arrayContaining([
        ['onion', 42],
        ['i2p', 42],
        ['ipv6', 80],
      ]),
    );
    expect(s.latency).toHaveLength(3);

    const withFastElectrs = peerSummary([
      peer({ network: 'electrs', latencyMs: 0, currentPingMs: 0 }),
      peer({ latencyMs: 100, currentPingMs: 120 }),
    ]);
    expect(withFastElectrs.fastest).toBe(100);
    expect(withFastElectrs.latency).toEqual([
      { network: 'ipv4', peers: 1, medianMs: 120, slow: false },
    ]);
  });

  it('skips unknown latencies and has no figures without measurements', () => {
    const s = peerSummary([
      peer({ latencyMs: null, currentPingMs: null }),
      peer({ latencyMs: 30, currentPingMs: null }),
    ]);
    expect(s.averageLatency).toBe(30);
    expect(s.latency).toEqual([]);

    expect(peerSummary([])).toEqual({
      total: 0,
      inbound: 0,
      byNetwork: [],
      averageLatency: null,
      fastest: null,
      latency: [],
    });
  });

  it('holds its invariants for any peer list', () => {
    const kinds: NetworkKind[] = ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns', 'electrs', 'local'];
    const ms = fc.option(fc.double({ min: 0, max: 1e5, noNaN: true }), { nil: null });
    const anyPeer = fc
      .record({
        network: fc.constantFrom(...kinds),
        inbound: fc.boolean(),
        latencyMs: ms,
        currentPingMs: ms,
      })
      .map((over) => peer(over));
    fc.assert(
      fc.property(fc.array(anyPeer, { maxLength: 40 }), (peers) => {
        const s = peerSummary(peers);
        expect(s.byNetwork.reduce((a, [, n]) => a + n, 0)).toBe(s.total);
        expect(s.inbound).toBeLessThanOrEqual(s.total);
        for (let i = 1; i < s.byNetwork.length; i++)
          expect(s.byNetwork[i - 1]![1]).toBeGreaterThanOrEqual(s.byNetwork[i]![1]);
        if (s.fastest === null) expect(s.averageLatency).toBeNull();
        else expect(s.fastest).toBeLessThanOrEqual(s.averageLatency! + 1e-9);
      }),
    );
  });
});

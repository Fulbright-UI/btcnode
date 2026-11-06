import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { peerLatency } from './latency.js';
import type { NetworkKind } from './status.js';
import { THRESHOLDS } from './thresholds.js';

const p = (network: NetworkKind, currentPingMs: number | null) => ({ network, currentPingMs });

describe('peerLatency', () => {
  it('takes the median per network and leaves electrs, local and unmeasured peers out', () => {
    const l = peerLatency([
      p('onion', 400),
      p('onion', 500),
      p('onion', 9000),
      p('i2p', 1000),
      p('i2p', 1200),
      p('electrs', 0),
      p('local', 1),
      p('ipv4', null),
    ]);
    expect(l).toEqual([
      { network: 'onion', peers: 3, medianMs: 500, slow: false },
      { network: 'i2p', peers: 2, medianMs: 1100, slow: false },
    ]);
  });

  it('judges each network by its own limit', () => {
    const at = (network: 'ipv4' | 'onion' | 'i2p', ms: number) =>
      peerLatency([p(network, ms), p(network, ms), p(network, ms)])[0]!.slow;
    expect(at('ipv4', 1500)).toBe(true);
    expect(at('onion', 1500)).toBe(false);
    expect(at('onion', 3500)).toBe(true);
    expect(at('i2p', 3500)).toBe(false);
    expect(at('i2p', 5500)).toBe(true);
  });

  it('does not judge a network with too few peers', () => {
    const few = Array.from({ length: THRESHOLDS.peerLatencyMinPeers - 1 }, () => p('ipv4', 9999));
    expect(peerLatency(few)[0]!.slow).toBe(false);
  });

  it('keeps the median between the fastest and the slowest ping', () => {
    const kinds: NetworkKind[] = ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns', 'electrs', 'local'];
    const anyPeer = fc.record({
      network: fc.constantFrom(...kinds),
      currentPingMs: fc.option(fc.double({ min: 0, max: 1e5, noNaN: true }), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(anyPeer, { maxLength: 40 }), (peers) => {
        for (const l of peerLatency(peers)) {
          const xs = peers
            .filter((x) => x.network === l.network && x.currentPingMs !== null)
            .map((x) => x.currentPingMs!);
          expect(l.peers).toBe(xs.length);
          expect(l.medianMs).toBeGreaterThanOrEqual(Math.min(...xs));
          expect(l.medianMs).toBeLessThanOrEqual(Math.max(...xs));
        }
      }),
    );
  });
});

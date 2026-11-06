import type { NetworkKind, Peer } from './status.js';
import { THRESHOLDS } from './thresholds.js';

/** Networks with a latency limit of their own; electrs and local peers are not the net. */
export type LatencyNetwork = keyof typeof THRESHOLDS.peerLatencyWarnMs;

export interface NetworkLatency {
  network: LatencyNetwork;
  /** Peers with a ping measurement */
  peers: number;
  /** Median of the current pings (ms) */
  medianMs: number;
  /** Above the network's limit, with enough peers for the median to mean something */
  slow: boolean;
}

function isLatencyNetwork(n: NetworkKind): n is LatencyNetwork {
  return Object.hasOwn(THRESHOLDS.peerLatencyWarnMs, n);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Median ping per network. Tor and I2P route through several hops, so one
 * limit for all of them either cries wolf over I2P or sleeps through slow
 * clearnet peers. The median keeps a single stalled peer from tipping the
 * figure. Backend and frontend both call this, so the notice and the colour
 * on screen always agree.
 */
export function peerLatency(peers: Pick<Peer, 'network' | 'currentPingMs'>[]): NetworkLatency[] {
  const pings = new Map<LatencyNetwork, number[]>();
  for (const p of peers) {
    if (p.currentPingMs === null || !isLatencyNetwork(p.network)) continue;
    const list = pings.get(p.network) ?? [];
    list.push(p.currentPingMs);
    pings.set(p.network, list);
  }
  return [...pings.entries()].map(([network, xs]) => {
    const medianMs = median(xs);
    return {
      network,
      peers: xs.length,
      medianMs,
      slow:
        xs.length >= THRESHOLDS.peerLatencyMinPeers &&
        medianMs > THRESHOLDS.peerLatencyWarnMs[network],
    };
  });
}

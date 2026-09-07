import type { NetworkKind, Peer } from '@btcnode/shared';

/** Latency figures leave our own electrs out: its 0 ms says nothing about the net. */
export function peerSummary(peers: Peer[]) {
  const byNetwork = new Map<NetworkKind, number>();
  for (const p of peers) byNetwork.set(p.network, (byNetwork.get(p.network) ?? 0) + 1);
  const remote = peers.filter((p) => p.network !== 'electrs');
  const latencies = remote.map((p) => p.latencyMs).filter((v): v is number => v !== null);
  const pings = remote.map((p) => p.currentPingMs).filter((v): v is number => v !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    total: peers.length,
    inbound: peers.filter((p) => p.inbound).length,
    byNetwork: [...byNetwork.entries()].sort((a, b) => b[1] - a[1]),
    averageLatency: mean(latencies),
    fastest: latencies.length ? Math.min(...latencies) : null,
    ownResponse: mean(pings),
  };
}

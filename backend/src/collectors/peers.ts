import type { NetworkKind, Peer } from '@btcnode/shared';
import type { BlockTraffic } from '../history/blockTraffic.js';
import type { BitcoinRpcClient } from '../rpc/client.js';
import { RpcError } from '../rpc/client.js';
import { peerInfoSchema } from '../rpc/schemas.js';
import type { PeerInfo } from '../rpc/schemas.js';

const BLOCK_MESSAGES = ['cmpctblock', 'block', 'blocktxn'];
const NETWORK_RANK: Record<NetworkKind, number> = {
  electrs: 0,
  onion: 1,
  ipv4: 2,
  ipv6: 3,
  i2p: 4,
  cjdns: 5,
  local: 6,
  unknown: 9,
};

export interface PeersResult {
  list: Peer[];
  total: number;
  ids: Set<number>;
  unavailable?: 'denied' | 'pending';
}

/**
 * Classify a peer's network. Two special cases:
 *  - a connection through our own onion service reaches bitcoind from
 *    127.0.0.1 and Core files it under `not_publicly_routable`; with
 *    onlynet=onion an inbound connection from there is Tor — and the one
 *    number that says whether the onion service is reachable at all. A
 *    second node on the home network is `not_publicly_routable` too, but
 *    carries a 192.168.… address and stays local, rightly;
 *  - our own electrs fetches blocks over P2P and arrives the same way; it
 *    says `electrs` in its user agent, and nothing over Tor answers in
 *    under two milliseconds.
 */
export function classifyPeer(p: PeerInfo): NetworkKind {
  const inbound = p.inbound;
  const local = p.addr.startsWith('127.0.0.1');
  const subver = (p.subver ?? '').toLowerCase();
  if (
    inbound &&
    local &&
    (subver.includes('electrs') || (p.minping !== undefined && p.minping * 1000 < 2))
  ) {
    return 'electrs';
  }
  if (p.network === 'not_publicly_routable') return inbound && local ? 'onion' : 'local';
  switch (p.network) {
    case 'ipv4':
    case 'ipv6':
    case 'onion':
    case 'i2p':
    case 'cjdns':
      return p.network;
    default:
      return 'unknown';
  }
}

export function toPeer(
  p: PeerInfo,
  now: number,
): Omit<Peer, 'blocksFrom' | 'lastBlockFromAt' | 'blocksTo' | 'lastBlockToAt' | 'announcedTip'> {
  const ping = p.pingtime;
  const best = p.minping;
  return {
    id: p.id,
    address: p.addr,
    network: classifyPeer(p),
    inbound: p.inbound,
    latencyMs:
      best !== undefined ? round1(best * 1000) : ping !== undefined ? round1(ping * 1000) : null,
    currentPingMs: ping !== undefined ? round1(ping * 1000) : null,
    connectedFor: Math.max(0, Math.floor(now - (p.conntime ?? now))),
    userAgent: (p.subver ?? '').replace(/^\/|\/$/g, ''),
    services: p.servicesnames ?? [],
    bytesSent: p.bytessent ?? 0,
    bytesReceived: p.bytesrecv ?? 0,
    addressesFrom: p.addr_processed ?? 0,
    addressesDropped: p.addr_rate_limited ?? 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export class PeerCollector {
  private last: PeersResult = { list: [], total: 0, ids: new Set() };

  constructor(
    private readonly rpc: BitcoinRpcClient,
    private readonly traffic: BlockTraffic,
    private readonly limit: number,
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  async collect(): Promise<PeersResult> {
    let raw;
    try {
      raw = await this.rpc.call('getpeerinfo', [], peerInfoSchema);
    } catch (err) {
      if (!(err instanceof RpcError)) throw err;
      // A hiccup is no reason to throw the list away: the last known peers
      // are far better than none. Say why the list may be empty, though.
      return { ...this.last, unavailable: err.kind === 'denied' ? 'denied' : 'pending' };
    }
    const now = this.now();
    const figures = this.traffic.update(
      raw.map((p) => ({
        id: p.id,
        lastBlock: p.last_block ?? null,
        blockBytes: BLOCK_MESSAGES.reduce((sum, m) => sum + (p.bytessent_per_msg?.[m] ?? 0), 0),
      })),
    );
    const peers: Peer[] = raw.map((p) => ({
      ...toPeer(p, now),
      ...figures.get(p.id)!,
      announcedTip: false,
    }));
    // Group by network first, fastest first within each group: dots of the
    // same colour stay together.
    peers.sort(
      (a, b) =>
        NETWORK_RANK[a.network] - NETWORK_RANK[b.network] ||
        (a.latencyMs ?? 9e9) - (b.latencyMs ?? 9e9),
    );
    this.last = {
      list: peers.slice(0, this.limit),
      total: peers.length,
      ids: new Set(peers.map((p) => p.id)),
    };
    return this.last;
  }
}

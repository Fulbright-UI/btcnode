interface Entry {
  from: number;
  fromAt: number | null;
  to: number;
  toAt: number | null;
  sentBlockBytes: number;
}

export interface TrafficInput {
  id: number;
  lastBlock: number | null;
  blockBytes: number;
}

export interface TrafficFigures {
  blocksFrom: number;
  lastBlockFromAt: number | null;
  blocksTo: number;
  lastBlockToAt: number | null;
}

/**
 * Core does not count blocks per peer. It reports the time of the last block
 * received from each and the bytes sent per message type; both compared
 * with the previous pass give "one more" in either direction. A peer that
 * reconnects gets a new id, so gone ids are simply dropped.
 */
export class BlockTraffic {
  private readonly entries = new Map<number, Entry>();

  constructor(private readonly now: () => number = () => Date.now() / 1000) {}

  update(peers: TrafficInput[]): Map<number, TrafficFigures> {
    const t = this.now();
    const seen = new Set<number>();
    const out = new Map<number, TrafficFigures>();
    for (const p of peers) {
      seen.add(p.id);
      let e = this.entries.get(p.id);
      if (!e) {
        e = { from: 0, fromAt: p.lastBlock, to: 0, toAt: null, sentBlockBytes: p.blockBytes };
        this.entries.set(p.id, e);
      } else {
        if (p.lastBlock && (e.fromAt === null || p.lastBlock > e.fromAt)) {
          e.from += 1;
          e.fromAt = p.lastBlock;
        }
        if (p.blockBytes > e.sentBlockBytes) {
          e.to += 1;
          e.toAt = t;
          e.sentBlockBytes = p.blockBytes;
        }
      }
      out.set(p.id, {
        blocksFrom: e.from,
        lastBlockFromAt: e.fromAt,
        blocksTo: e.to,
        lastBlockToAt: e.toAt,
      });
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.entries.delete(id);
    return out;
  }
}

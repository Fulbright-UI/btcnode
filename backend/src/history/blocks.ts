import type { BlockStat } from '@btcnode/shared';
import type { BitcoinRpcClient } from '../rpc/client.js';
import { RpcError } from '../rpc/client.js';
import { blockStatsSchema } from '../rpc/schemas.js';
import type { PassBudget } from '../util/budget.js';

const KEEP = 144; // roughly 24 hours
const REORG_DEPTH = 6;

/**
 * Per-block figures of the last day. The first pass loads 144 blocks, after
 * that only what is new; a reorg (same height, different hash) drops the
 * last few so they are re-read from the chain that actually stands.
 */
export class BlockHistory {
  private entries: BlockStat[] = [];
  private tip: { height: number; hash: string } | null = null;

  get list(): readonly BlockStat[] {
    return this.entries;
  }

  async update(
    rpc: BitcoinRpcClient,
    tipHeight: number,
    tipHash: string,
    budget: PassBudget,
  ): Promise<void> {
    if (!tipHeight) return;
    // A shorter chain than we hold: everything above the tip is gone.
    this.entries = this.entries.filter((e) => e.height <= tipHeight);
    if (this.tip && this.tip.height === tipHeight && this.tip.hash !== tipHash) {
      this.entries = this.entries.filter((e) => e.height <= tipHeight - REORG_DEPTH);
    }
    this.tip = { height: tipHeight, hash: tipHash };

    const present = new Set(this.entries.map((e) => e.height));
    const start = Math.max(1, tipHeight - KEEP + 1);
    for (let h = start; h <= tipHeight; h++) {
      if (present.has(h)) continue;
      if (budget.spent()) break;
      try {
        const st = await rpc.call(
          'getblockstats',
          [h, ['height', 'time', 'total_out', 'txs', 'feerate_percentiles']],
          blockStatsSchema,
        );
        this.entries.push({
          height: st.height,
          time: st.time,
          totalOut: st.total_out,
          medianFee: st.feerate_percentiles[2] ?? 0,
          txCount: st.txs,
        });
      } catch (err) {
        if (err instanceof RpcError) return; // not allowed or block missing — stop quietly
        throw err;
      }
    }
    this.entries.sort((a, b) => a.height - b.height);
    if (this.entries.length > KEEP) this.entries = this.entries.slice(-KEEP);
  }
}

import { RETARGET_INTERVAL } from '@btcnode/shared';
import type { BitcoinRpcClient } from '../rpc/client.js';
import { RpcError } from '../rpc/client.js';
import type { PassBudget } from '../util/budget.js';
import { z } from 'zod';

const PER_PASS = 120;
/** Difficulty periods in a year, for the ticker's comparison */
export const HASHRATE_YEAR_PERIODS = 26;

/**
 * The curve behind the state bar: one point per difficulty period since the
 * genesis block plus the tip, fetched newest first so the headline stands
 * right away. Every point — the tip included — is Core's estimate over a
 * trailing full period; a shorter window right after a retarget was a draw
 * from an exponential distribution, not a measurement.
 */
export class HashrateHistory {
  private points = new Map<number, number>();

  get list(): [number, number][] {
    return [...this.points.entries()].sort((a, b) => a[0] - b[0]);
  }

  /** Every anchor for this tip is present — the curve will not change shape until the next block. */
  isComplete(tip: number): boolean {
    return tip > 0 && this.anchors(tip).every((h) => this.points.has(h));
  }

  anchors(tip: number): number[] {
    const fixed: number[] = [];
    for (let h = RETARGET_INTERVAL; h <= tip; h += RETARGET_INTERVAL) fixed.push(h);
    if (fixed[fixed.length - 1] !== tip) fixed.push(tip);
    return fixed;
  }

  async update(rpc: BitcoinRpcClient, tip: number, budget: PassBudget): Promise<void> {
    if (!tip) return;
    const anchors = this.anchors(tip);
    const keep = new Set(anchors);
    for (const h of [...this.points.keys()]) if (!keep.has(h)) this.points.delete(h);
    const missing = anchors
      .filter((h) => !this.points.has(h))
      .reverse()
      .slice(0, PER_PASS);
    for (const height of missing) {
      if (budget.spent()) break;
      const window = height >= RETARGET_INTERVAL ? RETARGET_INTERVAL : height;
      try {
        const rate = await rpc.call('getnetworkhashps', [window, height], z.number());
        this.points.set(height, rate);
      } catch (err) {
        if (err instanceof RpcError) return; // not whitelisted: no curve, quietly
        throw err;
      }
    }
  }
}

import { BLOCK_INTERVAL_SECONDS, HALVING_INTERVAL, RETARGET_INTERVAL } from '@btcnode/shared';
import type { NodeStatus } from '@btcnode/shared';
import type { BlockHistory } from '../history/blocks.js';
import type { HashrateHistory } from '../history/hashrate.js';
import type { ProgressTracker } from '../history/progress.js';
import type { BitcoinRpcClient } from '../rpc/client.js';
import { RpcError } from '../rpc/client.js';
import {
  blockchainInfoSchema,
  estimateSmartFeeSchema,
  mempoolInfoSchema,
  networkInfoSchema,
} from '../rpc/schemas.js';
import type { PassBudget } from '../util/budget.js';
import { z } from 'zod';

export interface NodeCollectorDeps {
  rpc: BitcoinRpcClient;
  blocks: BlockHistory;
  hashrate: HashrateHistory;
  progress: ProgressTracker;
  /** When the tip reached us, from the journal; null when unknown */
  tipArrivedAt: (height: number) => number | null;
  now?: () => number;
}

export function halvingFacts(height: number, now: number) {
  const epoch = Math.floor(height / HALVING_INTERVAL);
  const nextHeight = (epoch + 1) * HALVING_INTERVAL;
  const blocksLeft = nextHeight - height;
  return {
    reward: 50 / 2 ** epoch,
    nextHeight,
    blocksLeft,
    estimatedAt: now + blocksLeft * BLOCK_INTERVAL_SECONDS,
  };
}

/** Query Bitcoin Core — read-only methods only — and fill the histories. */
export async function collectNode(
  deps: NodeCollectorDeps,
  budget: PassBudget,
): Promise<NodeStatus> {
  const { rpc } = deps;
  const now = deps.now ?? (() => Date.now() / 1000);
  const chain = await rpc.call('getblockchaininfo', [], blockchainInfoSchema);
  const net = await rpc.call('getnetworkinfo', [], networkInfoSchema);
  const mempool = await rpc.call('getmempoolinfo', [], mempoolInfoSchema);
  const uptime = await rpc.call('uptime', [], z.number());

  const progress = Math.min(1, chain.verificationprogress);
  const inSync = progress >= 0.99999 && !chain.initialblockdownload;
  const headers = chain.headers;

  deps.progress.record(progress);
  const estimate = inSync ? null : deps.progress.estimate(progress);

  // Only once the chain is up to date — during the initial sync the figures
  // would be from 2010 and fetching them a pure waste.
  if (inSync) {
    await deps.blocks.update(rpc, chain.blocks, chain.bestblockhash, budget);
    await deps.hashrate.update(rpc, chain.blocks, budget);
  }

  const fees = {
    economical: null as number | null,
    conservative: null as number | null,
    lastBlockMedian: null as number | null,
  };
  if (inSync) {
    for (const mode of ['economical', 'conservative'] as const) {
      try {
        const r = await rpc.call(
          'estimatesmartfee',
          [1, mode.toUpperCase()],
          estimateSmartFeeSchema,
        );
        if (r.feerate) fees[mode] = r.feerate * 1e5; // BTC/kvB → sat/vB
      } catch (err) {
        if (!(err instanceof RpcError)) throw err;
        break;
      }
    }
    const last = deps.blocks.list[deps.blocks.list.length - 1];
    fees.lastBlockMedian = last ? last.medianFee : null;
  }

  return {
    blocks: chain.blocks,
    headers,
    verificationProgress: progress,
    initialBlockDownload: chain.initialblockdownload,
    inSync,
    bestBlockHash: chain.bestblockhash,
    tipTime: chain.time ?? null,
    tipArrivedAt: deps.tipArrivedAt(chain.blocks),
    sizeOnDisk: chain.size_on_disk ?? 0,
    pruned: chain.pruned ?? false,
    userAgent: net.subversion.replace(/^\/|\/$/g, ''),
    protocolVersion: net.protocolversion,
    uptime,
    connections: {
      total: net.connections,
      inbound: net.connections_in ?? 0,
      outbound: net.connections_out ?? 0,
    },
    difficulty: chain.difficulty,
    retargetIn: RETARGET_INTERVAL - (headers % RETARGET_INTERVAL),
    halving: halvingFacts(headers, now()),
    mempool: {
      txCount: mempool.size,
      usage: mempool.usage,
      maxUsage: mempool.maxmempool ?? 0,
      totalFee: Math.round((mempool.total_fee ?? 0) * 1e8),
    },
    fees,
    sync: {
      ratePerHour: estimate?.ratePerHour ?? null,
      remainingSeconds: estimate?.remainingSeconds ?? null,
      history: inSync ? [] : deps.progress.history,
    },
    self: {
      services: net.localservicesnames ?? [],
      // I2P destinations have no port; Core reports 0 there, and ":0" would
      // read like a misconfiguration on the page.
      localAddresses: (net.localaddresses ?? []).map((a) =>
        a.port > 0 ? `${a.address}:${a.port}` : a.address,
      ),
      relayFee: (net.relayfee ?? 0) * 1e5,
    },
  };
}

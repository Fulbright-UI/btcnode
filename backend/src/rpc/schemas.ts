import { z } from 'zod';

/** Only the fields we read. Core's names are kept verbatim — they are the API. */

export const blockchainInfoSchema = z.object({
  blocks: z.number().int(),
  headers: z.number().int(),
  bestblockhash: z.string(),
  difficulty: z.number(),
  time: z.number().optional(),
  verificationprogress: z.number(),
  initialblockdownload: z.boolean(),
  size_on_disk: z.number().optional(),
  pruned: z.boolean().optional(),
});
export type BlockchainInfo = z.infer<typeof blockchainInfoSchema>;

export const networkInfoSchema = z.object({
  subversion: z.string(),
  protocolversion: z.number().int(),
  connections: z.number().int(),
  connections_in: z.number().int().optional(),
  connections_out: z.number().int().optional(),
  localservicesnames: z.array(z.string()).optional(),
  localaddresses: z.array(z.object({ address: z.string(), port: z.number().int() })).optional(),
  relayfee: z.number().optional(),
});
export type NetworkInfo = z.infer<typeof networkInfoSchema>;

export const mempoolInfoSchema = z.object({
  size: z.number().int(),
  usage: z.number(),
  maxmempool: z.number().optional(),
  total_fee: z.number().optional(),
});

export const peerInfoSchema = z.array(
  z.object({
    id: z.number().int(),
    addr: z.string(),
    network: z.string(),
    inbound: z.boolean(),
    conntime: z.number().optional(),
    pingtime: z.number().optional(),
    minping: z.number().optional(),
    subver: z.string().optional(),
    servicesnames: z.array(z.string()).optional(),
    bytessent: z.number().optional(),
    bytesrecv: z.number().optional(),
    last_block: z.number().optional(),
    bytessent_per_msg: z.record(z.string(), z.number()).optional(),
    addr_processed: z.number().optional(),
    addr_rate_limited: z.number().optional(),
  }),
);
export type PeerInfo = z.infer<typeof peerInfoSchema>[number];

export const blockStatsSchema = z.object({
  height: z.number().int(),
  time: z.number(),
  total_out: z.number(),
  txs: z.number().int(),
  feerate_percentiles: z.array(z.number()).length(5),
});

export const estimateSmartFeeSchema = z.object({
  feerate: z.number().optional(),
  errors: z.array(z.string()).optional(),
});

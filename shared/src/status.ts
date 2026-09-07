import { z } from 'zod';

/**
 * The status snapshot: everything the page shows, as facts. No sentences,
 * no formatted numbers, no markup — wording and notation belong to the
 * frontend and its locale files. Times are unix seconds, sizes are bytes,
 * fees are sat/vB, fractions are 0..1.
 */

export const levelSchema = z.enum(['ok', 'warn', 'error', 'stale', 'starting', 'sync']);
export type Level = z.infer<typeof levelSchema>;

/** Codes for every notice the state bar can raise. The frontend translates them. */
export const warningCodeSchema = z.enum([
  'chainCheckAhead',
  'temperature',
  'cpu',
  'memory',
  'disk',
  'power',
  'connections',
  'mempoolFull',
  'electrumStopped',
  'electrumNotResponding',
  'electrumIndexing',
  'ownResponseSlow',
  'updatesAvailable',
]);
export type WarningCode = z.infer<typeof warningCodeSchema>;

export const warningSchema = z.object({
  code: warningCodeSchema,
  /** Optional numbers the message may mention (a temperature, a block count) */
  params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});
export type Warning = z.infer<typeof warningSchema>;

export const errorKindSchema = z.enum(['unreachable', 'auth', 'rpc']);

export const stateSchema = z.object({
  level: levelSchema,
  warnings: z.array(warningSchema),
  /** Set when the node counts as gone (level 'error') */
  error: z.object({ kind: errorKindSchema, message: z.string() }).optional(),
  /** What Core reported while starting up ("Verifying blocks…"), level 'starting' */
  warmupMessage: z.string().optional(),
  /** Seconds since the last successful pass, level 'stale' */
  staleFor: z.number().nonnegative().optional(),
});

export const networkKindSchema = z.enum([
  'ipv4',
  'ipv6',
  'onion',
  'i2p',
  'cjdns',
  'electrs',
  'local',
  'unknown',
]);
export type NetworkKind = z.infer<typeof networkKindSchema>;

export const peerSchema = z.object({
  id: z.number().int(),
  address: z.string(),
  network: networkKindSchema,
  inbound: z.boolean(),
  /** Best round trip ever measured (link latency), ms */
  latencyMs: z.number().nullable(),
  /** Most recent round trip — mostly our own load, ms */
  currentPingMs: z.number().nullable(),
  connectedFor: z.number().int().nonnegative(),
  userAgent: z.string(),
  services: z.array(z.string()),
  bytesSent: z.number().int().nonnegative(),
  bytesReceived: z.number().int().nonnegative(),
  /**
   * Address gossip: how many peer addresses this peer has told us about
   * (accepted into the address book) and how many it sent beyond the rate
   * limit and were dropped. The only visible trace of the gossip — who
   * told whom is not logged anywhere.
   */
  addressesFrom: z.number().int().nonnegative(),
  addressesDropped: z.number().int().nonnegative(),
  /** Blocks received from / sent to this peer since the backend started */
  blocksFrom: z.number().int().nonnegative(),
  lastBlockFromAt: z.number().nullable(),
  blocksTo: z.number().int().nonnegative(),
  lastBlockToAt: z.number().nullable(),
  /** This peer announced the current tip first */
  announcedTip: z.boolean(),
});
export type Peer = z.infer<typeof peerSchema>;

export const peersSchema = z.object({
  /** Peers drawn on the map (at most `peersMax`), grouped by network, fastest first */
  list: z.array(peerSchema),
  /** How many the node holds in total — the map may show fewer */
  total: z.number().int().nonnegative(),
  /** Why the list is empty: the call is not allowed, or it just did not answer */
  unavailable: z.enum(['denied', 'pending']).optional(),
});

export const announcementSchema = z.object({
  height: z.number().int(),
  peerId: z.number().int(),
  at: z.number(),
  /** The announcing peer is currently connected (and may be in `peers.list`) */
  connected: z.boolean(),
  /** Announced before the last node restart — the id cannot be matched to a peer */
  beforeRestart: z.boolean(),
  /** Short address when the peer is known */
  address: z.string().optional(),
});

export const rankingEntrySchema = z.object({
  peerId: z.number().int(),
  count: z.number().int().positive(),
  connected: z.boolean(),
  beforeRestart: z.boolean(),
  address: z.string().optional(),
});

export const chainSampleSchema = z.object({
  at: z.number(),
  peerId: z.number().int(),
  height: z.number().int(),
  /** Compared with our own height at that time */
  verdict: z.enum(['same', 'behind', 'ahead']),
});

export const chainCheckSchema = z.object({
  samples: z.array(chainSampleSchema),
  /** Largest lead a stranger reported, blocks */
  ahead: z.number().int().nonnegative(),
  /** Two or more ahead and the newest among them — the state bar turns */
  alarm: z.boolean(),
  /** This Core version does not log the height of a probe */
  unsupported: z.boolean(),
});

export const nodeSchema = z.object({
  blocks: z.number().int().nonnegative(),
  headers: z.number().int().nonnegative(),
  verificationProgress: z.number().min(0).max(1),
  initialBlockDownload: z.boolean(),
  inSync: z.boolean(),
  bestBlockHash: z.string(),
  /** Timestamp inside the tip block (the miner's clock) */
  tipTime: z.number().nullable(),
  /** When the tip reached us, from the journal — preferred for "x ago" */
  tipArrivedAt: z.number().nullable(),
  sizeOnDisk: z.number().nonnegative(),
  pruned: z.boolean(),
  userAgent: z.string(),
  protocolVersion: z.number().int(),
  uptime: z.number().int().nonnegative(),
  connections: z.object({
    total: z.number().int().nonnegative(),
    inbound: z.number().int().nonnegative(),
    outbound: z.number().int().nonnegative(),
  }),
  difficulty: z.number().nonnegative(),
  retargetIn: z.number().int().positive(),
  halving: z.object({
    reward: z.number(),
    nextHeight: z.number().int(),
    blocksLeft: z.number().int().nonnegative(),
    estimatedAt: z.number(),
  }),
  mempool: z.object({
    txCount: z.number().int().nonnegative(),
    usage: z.number().nonnegative(),
    maxUsage: z.number().nonnegative(),
    /** sat */
    totalFee: z.number().nonnegative(),
  }),
  fees: z.object({
    economical: z.number().nullable(),
    conservative: z.number().nullable(),
    lastBlockMedian: z.number().nullable(),
  }),
  sync: z.object({
    /** Percentage points per hour, once measurable */
    ratePerHour: z.number().nullable(),
    remainingSeconds: z.number().nullable(),
    /** [unix seconds, fraction] — coarse history for the curve */
    history: z.array(z.tuple([z.number(), z.number()])),
  }),
  /** This node as a peer would see it (the hub in the network map) */
  self: z.object({
    services: z.array(z.string()),
    localAddresses: z.array(z.string()),
    /** sat/vB */
    relayFee: z.number(),
  }),
});
export type NodeStatus = z.infer<typeof nodeSchema>;

export const blockStatSchema = z.object({
  height: z.number().int(),
  time: z.number(),
  /** sat */
  totalOut: z.number().nonnegative(),
  /** median fee, sat/vB */
  medianFee: z.number().nonnegative(),
  txCount: z.number().int().nonnegative(),
});
export type BlockStat = z.infer<typeof blockStatSchema>;

export const hashrateSchema = z.object({
  /** [height, hashes per second], one per difficulty period plus the tip */
  points: z.array(z.tuple([z.number().int(), z.number().nonnegative()])),
  /** Periods back used for the year-ago comparison */
  yearPeriods: z.number().int().positive(),
  /** All anchors fetched — until then the curve is still filling from the tip backwards */
  complete: z.boolean(),
});

export const powerSchema = z.object({
  undervoltageNow: z.boolean(),
  undervoltageSinceBoot: z.boolean(),
  throttled: z.boolean(),
});

export const systemSchema = z.object({
  temperature: z.number().nullable(),
  /** Peak per clock hour of the last day, oldest first; unix hour start */
  temperatureHourly: z.array(z.object({ hour: z.number(), peak: z.number() })),
  cpuPercent: z.number().nullable(),
  memory: z.object({ used: z.number(), total: z.number() }).nullable(),
  disk: z.object({ used: z.number(), total: z.number(), free: z.number() }).nullable(),
  uptime: z.number().nullable(),
  power: powerSchema.nullable(),
});

export const electrumSchema = z.object({
  /** A server was found (unit or open port) */
  configured: z.boolean(),
  port: z.number().int(),
  running: z.boolean(),
  reachable: z.boolean(),
  /** Height the index has reached; null when unknown, 'unreadable' when the source gives nonsense */
  indexedHeight: z.number().int().nullable(),
  indexReadable: z.boolean(),
  /** Known by unit name (electrs) or only by its port (any Electrum server) */
  knownByUnit: z.boolean(),
  lanAddress: z.string().nullable(),
  onionAddress: z.string().nullable(),
});

export const updateEntrySchema = z.object({
  name: z.string(),
  installed: z.string(),
  latest: z.string().nullable(),
  outdated: z.boolean(),
});

export const updatesSchema = z.object({
  checkedAt: z.number(),
  viaTor: z.boolean(),
  entries: z.array(updateEntrySchema),
});

export const statusSnapshotSchema = z.object({
  dashboardVersion: z.string(),
  generatedAt: z.number(),
  intervals: z.object({ status: z.number().int().positive(), log: z.number().int().positive() }),
  hostname: z.string(),
  peersMax: z.number().int().positive(),
  state: stateSchema,
  node: nodeSchema.nullable(),
  /** Per-block figures of the last ~24 h, oldest first (only once in sync) */
  blocks24h: z.array(blockStatSchema),
  hashrate: hashrateSchema,
  peers: peersSchema,
  tipAnnouncement: announcementSchema.nullable(),
  /** First announcers of the last 24 h, most frequent first */
  announcerRanking: z.array(rankingEntrySchema),
  announcedTotal: z.number().int().nonnegative(),
  chainCheck: chainCheckSchema,
  system: systemSchema,
  electrum: electrumSchema,
  updates: updatesSchema.nullable(),
  /** Which configured log units could not be found */
  logUnitsMissing: z.array(z.string()),
});

export type StatusSnapshot = z.infer<typeof statusSnapshotSchema>;

/**
 * Every threshold the dashboard judges by, in one place. The backend uses
 * them to flag values, the frontend to colour them — both sides read the
 * same numbers, so a value can never be yellow in the API and green on
 * screen.
 */
export const THRESHOLDS = {
  /** °C — yellow from here, red from `temperatureHigh` */
  temperatureWarn: 60,
  temperatureHigh: 75,
  /** Fixed scale of the temperature bars, so a calm day looks calm */
  temperatureScale: { floor: 30, ceiling: 90 },
  /** % CPU between two passes */
  cpuWarn: 85,
  /** Fraction of memory in use */
  memoryWarn: 0.92,
  /** Fraction of the data disk in use: yellow, then red */
  diskWarn: 0.88,
  diskCritical: 0.95,
  /** Fewer peers than this is unusual for a healthy node */
  connectionsMin: 8,
  /** Mempool usage over maxmempool: cheap transactions start being dropped */
  mempoolFullWarn: 0.8,
  /** Median ping per network above this is slow (ms). Tor and I2P take several hops. */
  peerLatencyWarnMs: { ipv4: 1000, ipv6: 1000, cjdns: 1000, onion: 3000, i2p: 5000 },
  /** Below this many measured peers a network's median is not judged */
  peerLatencyMinPeers: 3,
  /** Fee tiers for the 24-hour bars in sat/vB: up to the first, up to the second, above */
  feeTiers: [2, 5] as const,
  /** Volume tiers relative to the 24-hour mean: below, up to twice, above */
  volumeTiers: [1, 2] as const,
} as const;

/** Blocks per difficulty period and per halving — protocol constants. */
export const RETARGET_INTERVAL = 2016;
export const HALVING_INTERVAL = 210_000;
/** Average block interval used for date estimates (seconds). */
export const BLOCK_INTERVAL_SECONDS = 600;

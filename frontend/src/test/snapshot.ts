import { statusSnapshotSchema } from '@btcnode/shared';
import type { Peer, StatusSnapshot } from '@btcnode/shared';

/** Seconds; every time in the fixture counts back from here. */
export const NOW = 1_790_000_000;

export function peer(over: Partial<Peer> = {}): Peer {
  return {
    id: 1,
    address: '198.51.100.7:8333',
    network: 'ipv4',
    inbound: false,
    latencyMs: 40,
    currentPingMs: 42,
    connectedFor: 3600,
    userAgent: '/Satoshi:31.1.0/',
    services: ['NETWORK', 'WITNESS'],
    bytesSent: 50_000,
    bytesReceived: 120_000,
    addressesFrom: 10,
    addressesDropped: 0,
    blocksFrom: 2,
    lastBlockFromAt: NOW - 600,
    blocksTo: 0,
    lastBlockToAt: null,
    announcedTip: false,
    ...over,
  };
}

/**
 * A synchronised node with an Electrum server, checked against the shared
 * schema so a test cannot drift from what the backend sends.
 */
export function snapshot(over: Partial<StatusSnapshot> = {}): StatusSnapshot {
  const tip = 915_312;
  const s: StatusSnapshot = {
    dashboardVersion: '4.0.0-test',
    generatedAt: NOW,
    intervals: { status: 21, log: 3 },
    hostname: 'testnode',
    peersMax: 64,
    state: { level: 'ok', warnings: [] },
    node: {
      blocks: tip,
      headers: tip,
      verificationProgress: 0.9999995,
      initialBlockDownload: false,
      inSync: true,
      bestBlockHash: 'hash-915312',
      tipTime: NOW - 300,
      tipArrivedAt: NOW - 290,
      sizeOnDisk: 870_000_000_000,
      pruned: false,
      userAgent: 'Satoshi:31.1.0',
      protocolVersion: 70016,
      uptime: 2280,
      connections: { total: 23, inbound: 5, outbound: 18 },
      difficulty: 126_300_000_000_000,
      retargetIn: 1968,
      halving: {
        reward: 3.125,
        nextHeight: 1_050_000,
        blocksLeft: 134_688,
        estimatedAt: NOW + 8e7,
      },
      mempool: { txCount: 41_233, usage: 198_800_000, maxUsage: 300_000_000, totalFee: 42_000_000 },
      fees: { economical: 2.8, conservative: 4.1, lastBlockMedian: 6 },
      sync: { ratePerHour: null, remainingSeconds: null, history: [] },
      self: {
        services: ['NETWORK', 'WITNESS', 'NETWORK_LIMITED', 'P2P_V2'],
        localAddresses: ['selfexample.onion:8333'],
        relayFee: 1,
      },
    },
    blocks24h: Array.from({ length: 6 }, (_, i) => ({
      height: tip - 5 + i,
      time: NOW - (6 - i) * 600,
      totalOut: 115_300_000_000 + i * 3_700_000_000,
      medianFee: 2 + (i % 4),
      txCount: 4197 + i * 13,
    })),
    hashrate: {
      points: [
        [tip - 4032, 1.3e20],
        [tip - 2016, 1.32e20],
        [tip, 1.35e20],
      ],
      yearPeriods: 26,
      complete: false,
    },
    peers: {
      list: [
        peer({ id: 0, address: '127.0.0.1:51102', network: 'electrs', inbound: true }),
        peer({ id: 3, address: 'peerexample.onion:8333', network: 'onion', inbound: true }),
        peer({ id: 7, address: '[2001:db8::7]:8333', network: 'ipv6', currentPingMs: 80 }),
        peer({ id: 9, address: 'peerexample.i2p:0', network: 'i2p', announcedTip: true }),
      ],
      total: 23,
    },
    tipAnnouncement: {
      height: tip,
      peerId: 9,
      at: NOW - 290,
      connected: true,
      beforeRestart: false,
      address: 'peerexample.i2p:0',
    },
    announcerRanking: [
      { peerId: 9, count: 13, connected: true, beforeRestart: false, address: 'peerexample.i2p:0' },
      { peerId: 2, count: 5, connected: false, beforeRestart: true },
    ],
    announcedTotal: 61,
    chainCheck: {
      samples: [
        { at: NOW - 3000, peerId: 800, height: tip - 1, verdict: 'behind' },
        { at: NOW - 600, peerId: 801, height: tip, verdict: 'same' },
      ],
      ahead: 0,
      alarm: false,
      unsupported: false,
    },
    system: {
      temperature: 52.5,
      temperatureHourly: [
        { hour: NOW - 7200, peak: 50 },
        { hour: NOW - 3600, peak: 52.5 },
      ],
      cpuPercent: 12,
      memory: { used: 409_600_000, total: 4_096_000_000 },
      disk: { used: 230_133_030_912, total: 509_880_758_272, free: 279_747_727_360 },
      uptime: 812.34,
      power: { undervoltageNow: false, undervoltageSinceBoot: false, throttled: false },
    },
    electrum: {
      configured: true,
      port: 50001,
      running: true,
      reachable: true,
      indexedHeight: tip,
      indexReadable: true,
      knownByUnit: true,
      lanAddress: '10.0.0.5:50001',
      onionAddress: 'electrsexample.onion:50001',
    },
    updates: {
      checkedAt: NOW - 1260,
      viaTor: true,
      entries: [
        { name: 'Bitcoin Core', installed: '31.1', latest: '31.1', outdated: false },
        { name: 'electrs', installed: '0.11.1', latest: '0.11.2', outdated: true },
      ],
    },
    logUnitsMissing: [],
    ...over,
  };
  return statusSnapshotSchema.parse(s);
}

import { THRESHOLDS } from '@btcnode/shared';
import type { StatusSnapshot } from '@btcnode/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { collectWarnings } from './assess.js';

type Facts = Parameters<typeof collectWarnings>[0];

/** A healthy node: no notice at all. */
function healthy(): Facts {
  return {
    chainCheck: { samples: [], ahead: 0, alarm: false, unsupported: false },
    system: {
      temperature: 50,
      temperatureHourly: [],
      cpuPercent: 10,
      memory: { used: 1, total: 4 },
      disk: { used: 1, total: 2, free: 1 },
      uptime: 100,
      power: { undervoltageNow: false, undervoltageSinceBoot: false, throttled: false },
    },
    node: {
      blocks: 1000,
      connections: { total: 20, inbound: 5, outbound: 15 },
      mempool: { txCount: 1, usage: 10, maxUsage: 300, totalFee: 0 },
    } as StatusSnapshot['node'],
    electrum: {
      configured: true,
      port: 50001,
      running: true,
      reachable: true,
      indexedHeight: 1000,
      indexReadable: true,
      knownByUnit: true,
      lanAddress: null,
      onionAddress: null,
    },
    peers: {
      list: [
        { network: 'electrs', currentPingMs: 99_999 },
        { network: 'onion', currentPingMs: 300 },
        { network: 'ipv4', currentPingMs: null },
      ] as StatusSnapshot['peers']['list'],
      total: 3,
    },
    updates: { checkedAt: 0, viaTor: false, entries: [] },
  };
}

const codes = (f: Facts) => collectWarnings(f).map((w) => w.code);

describe('notices', () => {
  it('has nothing to say about a healthy node, nor about one without facts', () => {
    expect(collectWarnings(healthy())).toEqual([]);
    const bare = healthy();
    bare.node = null;
    bare.electrum = { ...bare.electrum, configured: false, running: false };
    bare.system = {
      ...bare.system,
      temperature: null,
      cpuPercent: null,
      memory: null,
      disk: null,
      power: null,
    };
    bare.peers = { list: [], total: 0 };
    bare.updates = null;
    expect(collectWarnings(bare)).toEqual([]);
  });

  it('names every problem, a stranger ahead of us first', () => {
    const f = healthy();
    f.chainCheck = { ...f.chainCheck, ahead: 2, alarm: true };
    f.system = {
      ...f.system,
      temperature: THRESHOLDS.temperatureHigh,
      cpuPercent: 91.4,
      memory: { used: 95, total: 100 },
      disk: { used: 90, total: 100, free: 10 },
      power: { undervoltageNow: false, undervoltageSinceBoot: true, throttled: false },
    };
    f.node!.connections.total = 3;
    f.node!.mempool.usage = 290;
    f.peers.list = [2500, 2600, 900].map((ms) => ({
      network: 'ipv4',
      currentPingMs: ms,
    })) as StatusSnapshot['peers']['list'];
    f.updates!.entries = [{ name: 'electrs', installed: '1', latest: '2', outdated: true }];
    expect(collectWarnings(f)).toEqual([
      { code: 'chainCheckAhead', params: { blocks: 2 } },
      { code: 'temperature', params: { value: THRESHOLDS.temperatureHigh } },
      { code: 'cpu', params: { value: 91 } },
      { code: 'memory', params: { percent: 95 } },
      { code: 'disk', params: { percent: 90 } },
      { code: 'power' },
      { code: 'connections', params: { value: 3 } },
      { code: 'mempoolFull' },
      { code: 'peerLatencySlow', params: { network: 'ipv4', ms: 2500 } },
      { code: 'updatesAvailable' },
    ]);
  });

  it('says one thing about Electrum: stopped, silent or behind', () => {
    const f = healthy();
    f.electrum = { ...f.electrum, running: false, reachable: false };
    expect(codes(f)).toEqual(['electrumStopped']);
    f.electrum = { ...f.electrum, running: true };
    expect(codes(f)).toEqual(['electrumNotResponding']);
    f.electrum = { ...f.electrum, reachable: true, indexedHeight: 990 };
    expect(collectWarnings(f)).toEqual([{ code: 'electrumIndexing', params: { blocks: 10 } }]);
    // one block behind is a block in flight, not indexing
    f.electrum = { ...f.electrum, indexedHeight: 999 };
    expect(codes(f)).toEqual([]);
  });

  it('flags the disk exactly from its threshold on', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (total, u) => {
          const used = Math.min(u, total);
          const f = healthy();
          f.system = { ...f.system, disk: { used, total, free: total - used } };
          expect(codes(f).includes('disk')).toBe(used / total >= THRESHOLDS.diskWarn);
        },
      ),
    );
  });
});

import { RETARGET_INTERVAL, statusSnapshotSchema } from '@btcnode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createEnv } from './helpers/env.js';
import type { TestEnv } from './helpers/env.js';

let env: TestEnv;
afterEach(async () => {
  await env?.stop();
});

describe('a node at the chain tip', () => {
  it('produces a snapshot that fits the contract and reads every card', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    const s = env.poller.status!;
    expect(statusSnapshotSchema.safeParse(s).success).toBe(true);
    expect(s.state.level).toBe('warn'); // electrs is 3 blocks behind
    expect(s.state.warnings.map((w) => w.code)).toEqual(['electrumIndexing']);
    expect(s.node?.inSync).toBe(true);
    expect(s.node?.blocks).toBe(env.node.tip);
    expect(s.node?.fees.economical).toBeCloseTo(2.8);
    expect(s.node?.fees.conservative).toBeCloseTo(4.1);
    expect(s.node?.halving.blocksLeft).toBe(1_050_000 - env.node.tip);
    expect(s.node?.retargetIn).toBe(RETARGET_INTERVAL - (env.node.tip % RETARGET_INTERVAL));
    expect(s.system.temperature).toBeCloseTo(69.6);
    expect(s.system.power).toEqual({
      undervoltageNow: false,
      undervoltageSinceBoot: false,
      throttled: false,
    });
    expect(s.system.memory?.total).toBe(4_000_000 * 1024);
    expect(s.electrum).toMatchObject({
      configured: true,
      running: true,
      reachable: true,
      indexedHeight: env.node.tip - 3,
    });
    expect(s.electrum.lanAddress).toBe(`192.168.1.50:${env.config.ELECTRUM_PORT}`);
    expect(s.electrum.onionAddress).toMatch(/\.onion:\d+$/);
    expect(s.updates?.entries).toHaveLength(2);
    expect(s.blocks24h).toHaveLength(144);
    expect(s.node?.tipArrivedAt).not.toBeNull();
    expect(s.node?.self.localAddresses).toEqual([
      expect.stringMatching(/\.onion:8333$/),
      expect.stringMatching(/\.b32\.i2p$/), // no ":0"
    ]);
  });

  it('classifies peers: electrs, inbound onion via 127.0.0.1, genuinely local, hostile agent kept as text', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    const peers = env.poller.status!.peers;
    expect(peers.total).toBe(23);
    const byId = new Map(peers.list.map((p) => [p.id, p]));
    expect(byId.get(0)?.network).toBe('electrs');
    expect(byId.get(1)?.network).toBe('onion');
    expect(byId.get(1)?.inbound).toBe(true);
    expect(byId.get(2)?.network).toBe('local');
    expect(byId.get(3)?.userAgent).toBe('<b>Knoten</b>:1.0');
    expect(byId.get(3)?.announcedTip).toBe(true);
    expect(byId.get(4)?.announcedTip).toBe(false);
    // grouped by network, fastest first inside each group
    expect(peers.list[0]?.network).toBe('electrs');
    const onions = peers.list.filter((p) => p.network === 'onion').map((p) => p.latencyMs ?? 0);
    expect(onions).toEqual([...onions].sort((a, b) => a - b));
    // latency is minping, the link — not pingtime, our own load
    expect(byId.get(3)?.latencyMs).toBe(293);
    // address gossip: what this peer has told us, and what we threw away
    expect(byId.get(3)?.addressesFrom).toBe(1411);
    expect(byId.get(3)?.addressesDropped).toBe(9);
    expect(byId.get(0)?.addressesFrom).toBe(0);
    expect(byId.get(3)?.currentPingMs).toBeGreaterThan(293);
  });

  it('asks for a full difficulty period for every hashrate point, the tip included', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    const windows = env.node.calls
      .filter((c) => c.method === 'getnetworkhashps')
      .map((c) => c.params[0]);
    expect(windows.length).toBeGreaterThan(50);
    expect(new Set(windows)).toEqual(new Set([RETARGET_INTERVAL]));
    const points = env.poller.status!.hashrate.points;
    expect(points[points.length - 1]?.[0]).toBe(env.node.tip);
    // 120 per pass: the first pass cannot be complete, a few more are
    for (let i = 0; i < 4 && !env.poller.status!.hashrate.complete; i++)
      await env.poller.runStatus();
    expect(env.poller.status!.hashrate.complete).toBe(true);
    expect(env.poller.status!.hashrate.points.length).toBe(
      Math.ceil(env.node.tip / RETARGET_INTERVAL) + 0,
    );
  });

  it('caches block figures: the second pass asks for nothing old', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    // a generous budget for the first pass filled 144 blocks; count from here
    const before = env.node.calls.filter((c) => c.method === 'getblockstats').length;
    expect(before).toBe(144);
    await env.poller.runStatus();
    const after = env.node.calls.filter((c) => c.method === 'getblockstats').length;
    expect(after).toBe(144);
  });

  it('reads the journal: announcer of the tip, ranking, restart boundary, chain check', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    const s = env.poller.status!;
    expect(s.tipAnnouncement).toMatchObject({
      height: env.node.tip,
      peerId: 3,
      connected: true,
      beforeRestart: false,
    });
    expect(s.tipAnnouncement?.address).toMatch(/\.onion:8333$/);
    expect(s.announcedTotal).toBe(61);
    // peer 3 announced before AND after the restart — the same id is two
    // different peers then, counted apart; only the recent one is "connected"
    expect(s.announcerRanking[0]).toMatchObject({
      peerId: 3,
      beforeRestart: true,
      connected: false,
    });
    expect(s.announcerRanking).toContainEqual(
      expect.objectContaining({ peerId: 3, beforeRestart: false, connected: true }),
    );
    expect(s.chainCheck.samples).toHaveLength(6);
    expect(s.chainCheck.samples.map((x) => x.verdict)).toEqual([
      'same',
      'behind',
      'same',
      'same',
      'same',
      'same',
    ]);
    expect(s.chainCheck.alarm).toBe(false);
  });

  it('raises the chain-check alarm only when two probes are ahead and the newest is one of them', async () => {
    env = await createEnv();
    const iso = (ago: number) =>
      new Date(Date.now() - ago * 1000).toISOString().slice(0, 19) + '+00:00';
    const claim = (ago: number, more: number, peer: number) =>
      `${iso(ago)} btcnode bitcoind[1]: New block-relay-only peer connected: transport: v2, version: 70016, blocks=${env.node.tip + more} peer=${peer}`;
    env.journal.lines.push(claim(120, 1400, 900));
    await env.poller.runStatus();
    expect(env.poller.status!.chainCheck.alarm).toBe(false); // a single claim stays a red dot
    // compared with our height AT THAT TIME (tip − 1, the tip came 41 s ago), not with the tip of now
    expect(env.poller.status!.chainCheck.ahead).toBe(1401);
    env.journal.lines.push(claim(30, 1401, 901));
    await env.poller.runStatus();
    expect(env.poller.status!.chainCheck.alarm).toBe(true);
    expect(env.poller.status!.state.warnings[0]?.code).toBe('chainCheckAhead');
  });
});

describe('the tolerance window', () => {
  it('keeps the last good state through short outages and gives up only after TOLERANCE failures', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    expect(env.poller.status!.state.level).toBe('warn');

    await env.node.stop(); // the node vanishes
    await env.poller.runStatus();
    expect(env.poller.status!.state.level).toBe('stale');
    expect(env.poller.status!.node?.blocks).toBe(env.node.tip); // old figures still shown
    expect(env.poller.status!.state.staleFor).toBeGreaterThanOrEqual(0);
    await env.poller.runStatus();
    expect(env.poller.status!.state.level).toBe('stale');
    await env.poller.runStatus();
    expect(env.poller.status!.state.level).toBe('error');
    expect(env.poller.status!.state.error?.kind).toBe('unreachable');
    expect(env.poller.status!.state.warnings).toEqual([]);
  });

  it('treats a warmup answer as starting, never as an outage, and keeps the old figures', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    env.node.warmupMessage = 'Verifying blocks…';
    for (let i = 0; i < 5; i++) await env.poller.runStatus();
    const s = env.poller.status!;
    expect(s.state.level).toBe('starting');
    expect(s.state.warmupMessage).toBe('Verifying blocks…');
    expect(s.node?.blocks).toBe(env.node.tip);
  });

  it('reports a wrong password as an auth error', async () => {
    env = await createEnv({ password: 'other' });
    for (let i = 0; i < 3; i++) await env.poller.runStatus();
    expect(env.poller.status!.state.level).toBe('error');
    expect(env.poller.status!.state.error?.kind).toBe('auth');
  });

  it('keeps the peer list when getpeerinfo is refused and says why', async () => {
    env = await createEnv();
    await env.poller.runStatus();
    env.node.denied.add('getpeerinfo');
    await env.poller.runStatus();
    const p = env.poller.status!.peers;
    expect(p.unavailable).toBe('denied');
    expect(p.total).toBe(23);
    // and it is not asked again right away
    const asks = env.node.calls.filter((c) => c.method === 'getpeerinfo').length;
    await env.poller.runStatus();
    expect(env.node.calls.filter((c) => c.method === 'getpeerinfo').length).toBe(asks);
  });
});

describe('the initial sync', () => {
  it('fetches no histories and no fee estimates, and reports sync', async () => {
    env = await createEnv({ scenario: 'syncing' });
    await env.poller.runStatus();
    const s = env.poller.status!;
    expect(s.state.level).toBe('sync');
    expect(s.node?.inSync).toBe(false);
    expect(s.blocks24h).toEqual([]);
    expect(s.hashrate.points).toEqual([]);
    expect(s.node?.fees.economical).toBeNull();
    expect(s.chainCheck.samples).toEqual([]);
    const methods = new Set(env.node.calls.map((c) => c.method));
    expect(methods.has('getblockstats')).toBe(false);
    expect(methods.has('estimatesmartfee')).toBe(false);
    expect(methods.has('getnetworkhashps')).toBe(false);
  });
});

describe('a node that answers but has nothing', () => {
  it('still fits the contract', async () => {
    env = await createEnv({ scenario: 'empty' });
    await env.poller.runStatus();
    const s = env.poller.status!;
    expect(statusSnapshotSchema.safeParse(s).success).toBe(true);
    expect(s.peers.list).toEqual([]);
    expect(s.state.warnings.map((w) => w.code)).toContain('connections');
  });
});

describe('the log', () => {
  it('delivers plain text, newest first, prefixes shortened', async () => {
    env = await createEnv();
    await env.poller.runLog();
    const lines = env.poller.log.split('\n');
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2} {2}Warning: something odd$/);
    expect(env.poller.log).not.toContain('btcnode bitcoind[');
  });

  it('serves the chronicle sorted with the backend start', async () => {
    env = await createEnv();
    const c = env.poller.chronicle;
    expect(c.entries).toHaveLength(2);
    expect(c.interval).toBe(21);
    expect(c.start).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});

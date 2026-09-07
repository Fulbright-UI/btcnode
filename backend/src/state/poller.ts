import type { Chronicle, NodeStatus, StatusSnapshot } from '@btcnode/shared';
import { statusSnapshotSchema } from '@btcnode/shared';
import type { Logger } from 'pino';
import type { ElectrumCollector } from '../collectors/electrum.js';
import { collectLog, renderLogText } from '../collectors/log.js';
import { collectNode } from '../collectors/node.js';
import type { PeerCollector, PeersResult } from '../collectors/peers.js';
import type { SystemCollector } from '../collectors/system.js';
import { readUpdates } from '../collectors/updates.js';
import type { Config } from '../config.js';
import { BlockHistory } from '../history/blocks.js';
import { HASHRATE_YEAR_PERIODS, HashrateHistory } from '../history/hashrate.js';
import { ProgressTracker } from '../history/progress.js';
import type { AnnouncementTracker } from '../journal/announcements.js';
import type { JournalReader } from '../journal/journalctl.js';
import type { BitcoinRpcClient } from '../rpc/client.js';
import { RpcError } from '../rpc/client.js';
import { PassBudget } from '../util/budget.js';
import { unitExists } from '../util/fs.js';
import { collectWarnings } from './assess.js';
import { judgeChainCheck } from './chainCheck.js';

export interface PollerDeps {
  config: Config;
  log: Logger;
  rpc: BitcoinRpcClient;
  journal: JournalReader;
  announcements: AnnouncementTracker;
  peers: PeerCollector;
  system: SystemCollector;
  electrum: ElectrumCollector;
  chronicleEntries: Chronicle['entries'];
  version: string;
  now?: () => number;
}

interface LastGood {
  at: number;
  node: NodeStatus;
  peers: PeersResult;
}

/**
 * Two clocks in one process: the node every STATUS_INTERVAL seconds, the log
 * every LOG_INTERVAL. The special case is the tolerance window: when the
 * node does not answer, the last good state stays — marked as stale — until
 * TOLERANCE passes in a row have failed. During the initial sync bitcoind
 * stalls its RPC thread while writing the dbcache, regularly longer than
 * one timeout; a red card for that would be a lie.
 */
export class Poller {
  private snapshot: StatusSnapshot | null = null;
  private logText = '[waiting for the first read]';
  private lastGood: LastGood | null = null;
  private failuresInRow = 0;
  private warmupMessage = '';
  private readonly blocks = new BlockHistory();
  private readonly hashrate = new HashrateHistory();
  private readonly progress: ProgressTracker;
  private readonly startedAt: number;
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private statusBusy = false;
  private logBusy = false;

  constructor(private readonly deps: PollerDeps) {
    const now = deps.now ?? (() => Date.now() / 1000);
    this.progress = new ProgressTracker(now);
    this.startedAt = Math.floor(now());
  }

  get status(): StatusSnapshot | null {
    return this.snapshot;
  }

  get log(): string {
    return this.logText;
  }

  get chronicle(): Chronicle {
    return {
      start: this.startedAt,
      interval: this.deps.config.STATUS_INTERVAL,
      entries: this.deps.chronicleEntries,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const { STATUS_INTERVAL, LOG_INTERVAL } = this.deps.config;
    void this.runStatus();
    void this.runLog();
    this.timers = [
      setInterval(() => void this.runStatus(), STATUS_INTERVAL * 1000),
      setInterval(() => void this.runLog(), LOG_INTERVAL * 1000),
    ];
    for (const t of this.timers) t.unref();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** One status pass; safe to call directly (tests). Never throws. */
  async runStatus(): Promise<void> {
    if (this.statusBusy) return; // a slow pass must not stack up behind itself
    this.statusBusy = true;
    try {
      this.snapshot = await this.pass();
    } catch (err) {
      this.deps.log.error({ err }, 'status pass failed');
    } finally {
      this.statusBusy = false;
    }
  }

  async runLog(): Promise<void> {
    if (this.logBusy) return;
    this.logBusy = true;
    try {
      const { config, journal } = this.deps;
      const sections = await collectLog(
        journal,
        config.logUnits,
        config.LOG_SOURCE === 'file' ? null : config.unitDirs,
        config.LOG_LINES,
      );
      this.logText = renderLogText(sections);
    } catch (err) {
      this.deps.log.error({ err }, 'log pass failed');
    } finally {
      this.logBusy = false;
    }
  }

  private async pass(): Promise<StatusSnapshot> {
    const { config, rpc, announcements } = this.deps;
    const now = this.deps.now ?? (() => Date.now() / 1000);
    // 70 % of one interval for the node; the rest belongs to publishing.
    const budget = new PassBudget(config.STATUS_INTERVAL * 0.7);

    let node: NodeStatus | null = null;
    let peers: PeersResult = { list: [], total: 0, ids: new Set() };
    let level: StatusSnapshot['state']['level'] = 'ok';
    let error: StatusSnapshot['state']['error'];
    let staleFor: number | undefined;
    let warmup: string | undefined;

    // The journal first: the tip's arrival time comes from it.
    await announcements.update();

    try {
      node = await collectNode(
        {
          rpc,
          blocks: this.blocks,
          hashrate: this.hashrate,
          progress: this.progress,
          tipArrivedAt: (h) => announcements.announced.get(h)?.at ?? null,
          now,
        },
        budget,
      );
      peers = await this.deps.peers.collect();
      this.failuresInRow = 0;
      this.warmupMessage = '';
      this.lastGood = { at: now(), node, peers };
    } catch (err) {
      if (!(err instanceof RpcError)) throw err;
      this.deps.log.warn({ kind: err.kind, method: err.method }, err.message);
      if (err.kind === 'warmup') {
        // Verifying blocks after a restart can take a quarter of an hour;
        // the tolerance window must not run out on it.
        this.failuresInRow = 0;
        this.warmupMessage = err.message;
        warmup = err.message;
        level = 'starting';
        if (this.lastGood) ({ node, peers } = this.lastGood);
      } else {
        this.failuresInRow += 1;
        if (this.failuresInRow >= config.TOLERANCE) {
          level = 'error';
          error = {
            kind: err.kind === 'auth' ? 'auth' : err.kind === 'unreachable' ? 'unreachable' : 'rpc',
            message: err.message,
          };
        } else if (this.lastGood) {
          level = 'stale';
          staleFor = now() - this.lastGood.at;
          ({ node, peers } = this.lastGood);
        } else {
          level = 'starting';
        }
      }
    }

    const tip = node?.blocks ?? null;
    const inSync = node?.inSync ?? false;
    const electrum = await this.deps.electrum.collect(tip);
    const system = await this.deps.system.collect();
    const updates = await readUpdates(config.UPDATES_FILE);
    const chainCheck = judgeChainCheck(announcements, tip, inSync);

    const tipAnn = tip !== null ? announcements.tipAnnouncement(tip) : null;
    const byId = new Map(peers.list.map((p) => [p.id, p]));
    const list = peers.list.map((p) => ({
      ...p,
      announcedTip: tipAnn?.peerId === p.id && !announcements.beforeRestart(tipAnn.at),
    }));

    const label = (peerId: number, beforeRestart: boolean) => {
      if (beforeRestart) return { connected: false as const };
      const p = byId.get(peerId);
      return { connected: peers.ids.has(peerId), ...(p ? { address: p.address } : {}) };
    };

    const warnings =
      level === 'error'
        ? []
        : collectWarnings({
            node,
            system,
            electrum,
            chainCheck,
            updates,
            peers: { ...peers, list },
          });
    if (level === 'ok') {
      if (!inSync) level = 'sync';
      else if (warnings.length) level = 'warn';
    }

    const missing: string[] = [];
    for (const unit of config.logUnits) {
      if (!(await unitExists(unit, config.unitDirs))) missing.push(unit);
    }

    const snapshot: StatusSnapshot = {
      dashboardVersion: this.deps.version,
      generatedAt: now(),
      intervals: { status: config.STATUS_INTERVAL, log: config.LOG_INTERVAL },
      hostname: config.HOSTNAME,
      peersMax: config.PEERS_MAX,
      state: {
        level,
        warnings,
        ...(error ? { error } : {}),
        ...((warmup ?? this.warmupMessage) ? { warmupMessage: warmup ?? this.warmupMessage } : {}),
        ...(staleFor !== undefined ? { staleFor } : {}),
      },
      node,
      blocks24h: inSync ? [...this.blocks.list] : [],
      hashrate: {
        points: inSync ? this.hashrate.list : [],
        yearPeriods: HASHRATE_YEAR_PERIODS,
        complete: inSync && tip !== null && this.hashrate.isComplete(tip),
      },
      peers: {
        list,
        total: peers.total,
        ...(peers.unavailable ? { unavailable: peers.unavailable } : {}),
      },
      tipAnnouncement: tipAnn
        ? {
            height: tipAnn.height,
            peerId: tipAnn.peerId,
            at: tipAnn.at,
            beforeRestart: announcements.beforeRestart(tipAnn.at),
            ...label(tipAnn.peerId, announcements.beforeRestart(tipAnn.at)),
          }
        : null,
      announcerRanking: announcements
        .ranking()
        .map((r) => ({ ...r, ...label(r.peerId, r.beforeRestart) })),
      announcedTotal: announcements.announced.size,
      chainCheck,
      system,
      electrum,
      updates,
      logUnitsMissing: missing,
    };
    // The contract is checked on the way out: a snapshot that does not fit
    // the schema is a bug here, not a surprise in the browser.
    return statusSnapshotSchema.parse(snapshot);
  }
}

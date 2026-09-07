import type { JournalReader } from './journalctl.js';
import { parseJournalLine } from './parse.js';

const ANNOUNCED_KEEP = 24 * 3600;
const SAMPLES_KEEP = 3600;
const PRIME_HOURS = 25;
const PRIME_MAX_LINES = 20_000;
const TAIL_LINES = 300;

export interface Announcement {
  peerId: number;
  at: number;
}

export interface ChainSample {
  at: number;
  peerId: number;
  height: number;
}

/**
 * What the journal says about blocks and strangers:
 *  - who announced each block first (`Saw new cmpctblock header …`) — the
 *    peer with the best view of the network, more telling than who delivered
 *    the bytes (over Tor nearly always the same high-bandwidth peer);
 *  - the chain-check samples (`New block-relay-only peer connected: … blocks=N`)
 *    — Core's own eclipse defence, a stranger asked for its height;
 *  - the restart marker, because Core numbers peers from zero at every start
 *    and an id from before the restart must never be matched to a peer of today.
 *
 * The first read looks a day back so the ranking is complete right after a
 * restart; later reads take only the newest lines.
 */
export class AnnouncementTracker {
  readonly announced = new Map<number, Announcement>();
  samples: ChainSample[] = [];
  nodeStartedAt = 0;
  /** Log lines seen that this Core version writes without the field we need */
  readonly formatGaps = new Set<'height' | 'sample'>();
  private primed = false;

  constructor(
    private readonly journal: JournalReader,
    private readonly unit: string,
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  beforeRestart(at: number): boolean {
    return at < this.nodeStartedAt;
  }

  async update(): Promise<void> {
    const result = this.primed
      ? await this.journal.tail(this.unit, TAIL_LINES)
      : await this.journal.since(this.unit, PRIME_HOURS, PRIME_MAX_LINES);
    // A failed priming must not loop forever: from now on the short window.
    this.primed = true;
    if (!result.ok) return;
    this.ingest(result.lines);
  }

  ingest(lines: string[]): void {
    const now = this.now();
    const seen = new Set(this.samples.map((s) => `${s.at}:${s.peerId}`));
    for (const line of lines) {
      const p = parseJournalLine(line, now);
      switch (p.kind) {
        case 'start':
          this.nodeStartedAt = Math.max(this.nodeStartedAt, p.at);
          break;
        case 'announce':
          // The first announcement counts; the journal is read oldest first.
          if (!this.announced.has(p.height))
            this.announced.set(p.height, { peerId: p.peerId, at: p.at });
          break;
        case 'announceNoHeight':
          this.formatGaps.add('height');
          break;
        case 'sample': {
          const key = `${p.at}:${p.peerId}`;
          if (!seen.has(key)) {
            seen.add(key);
            this.samples.push({ at: p.at, peerId: p.peerId, height: p.height });
          }
          break;
        }
        case 'sampleNoBlocks':
          this.formatGaps.add('sample');
          break;
      }
    }
    const announcedCutoff = now - ANNOUNCED_KEEP;
    for (const [h, a] of this.announced) if (a.at < announcedCutoff) this.announced.delete(h);
    const sampleCutoff = now - SAMPLES_KEEP;
    this.samples = this.samples.filter((s) => s.at >= sampleCutoff).sort((a, b) => a.at - b.at);
  }

  /** Our own height at a past moment, from the announcements. */
  ownHeightAt(at: number, tip: number): number {
    let best = 0;
    for (const [h, a] of this.announced) if (a.at <= at + 2 && h > best) best = h;
    return best || tip;
  }

  /** The newest announcement, if it still belongs to the tip. */
  tipAnnouncement(tip: number): { height: number; peerId: number; at: number } | null {
    if (!this.announced.size) return null;
    const height = Math.max(...this.announced.keys());
    if (tip && height < tip - 1) return null; // stale: the node moved on without a logged announcement
    const a = this.announced.get(height)!;
    return { height, peerId: a.peerId, at: a.at };
  }

  /** Who announced most blocks first in the last 24 h; the same id before and after a restart counts apart. */
  ranking(limit = 3): { peerId: number; count: number; beforeRestart: boolean }[] {
    const counts = new Map<string, { peerId: number; count: number; beforeRestart: boolean }>();
    for (const a of this.announced.values()) {
      const old = this.beforeRestart(a.at);
      const key = `${a.peerId}:${old}`;
      const e = counts.get(key) ?? { peerId: a.peerId, count: 0, beforeRestart: old };
      e.count += 1;
      counts.set(key, e);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }
}

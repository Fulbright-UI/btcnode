/**
 * Bitcoin Core's debug log is not an API; its wording moves with almost every
 * release. Every pattern here is written out with the versions it matches so
 * the next change is a one-line edit, not a silently blank card.
 */

/**
 * journalctl --output=short-iso: 2026-08-23T11:31:50+02:00 host unit[pid]: message
 * The offset is written with a colon by systemd ≥ 253 and without one by
 * older builds (+0000, Debian bookworm's 252 — the one in the container).
 * Missing that turned every line's time into "now": the chain check called
 * 251 of 260 probes "behind", and the log kept its full prefix (2026-09-07).
 */
export const JOURNAL_LINE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2})\s+\S+\s+[\w.@-]+(?:\[\d+\])?:\s*(.*)$/;

/**
 * Core's own debug.log: 2026-09-07T18:17:51Z message — always UTC, no host,
 * no unit. That is the source for a bitcoind in a container (LOG_SOURCE=file).
 * With -logtimemicros the seconds carry a fraction, which is skipped.
 */
export const CORE_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z\s+(.*)$/;

/**
 *   v26–v29  Saw new cmpctblock header hash=… peer=311            (no height)
 *   v30–v31  Saw new cmpctblock header hash=… height=… peer=311
 *   master   Saw new cmpctblock header hash=… height=… peer=311[, peeraddr=…]
 */
export const ANNOUNCE_LINE =
  /Saw new (?:cmpctblock )?header hash=\S+\s+height=(\d+)\b.*?\bpeer=(\d+)/;
export const ANNOUNCE_LINE_NO_HEIGHT = /Saw new (?:cmpctblock )?header hash=\S+\s+peer=(\d+)/;

/**
 *   v26–v30  New block-relay-only v2 peer connected: version: …, blocks=…, peer=…
 *   v31      New block-relay-only peer connected: transport: v2, version: …, blocks=… peer=…
 *   master   … no blocks= at all
 */
export const SAMPLE_LINE =
  /New (?:block-relay-only|outbound-full-relay|feeler)\b[^:]*peer connected: .*?\bblocks=(-?\d+)\b.*?\bpeer=(\d+)/;
export const SAMPLE_LINE_NO_BLOCKS =
  /New (?:block-relay-only|outbound-full-relay|feeler)\b[^:]*peer connected: (?!.*\bblocks=)/;

/** Bitcoin Core version v31.1.0 (release build) — the restart marker */
export const START_LINE = /Bitcoin Core version v?\d/;

export type ParsedLine =
  | { kind: 'start'; at: number }
  | { kind: 'announce'; at: number; height: number; peerId: number }
  | { kind: 'announceNoHeight'; at: number; peerId: number }
  | { kind: 'sample'; at: number; height: number; peerId: number }
  | { kind: 'sampleNoBlocks'; at: number }
  | { kind: 'other'; at: number };

export function parseTimestamp(line: string, fallback: number): number {
  let iso: string;
  const m = JOURNAL_LINE.exec(line);
  if (m) {
    // "+0000" → "+00:00": Date.parse wants the ISO form
    iso = m[1]!.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  } else {
    const c = CORE_LINE.exec(line);
    if (!c) return fallback;
    iso = c[1]! + 'Z';
  }
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback : t / 1000;
}

export function parseJournalLine(line: string, fallbackTime: number): ParsedLine {
  const at = parseTimestamp(line, fallbackTime);
  if (START_LINE.test(line)) return { kind: 'start', at };
  let m = ANNOUNCE_LINE.exec(line);
  if (m) return { kind: 'announce', at, height: Number(m[1]), peerId: Number(m[2]) };
  m = ANNOUNCE_LINE_NO_HEIGHT.exec(line);
  if (m) return { kind: 'announceNoHeight', at, peerId: Number(m[1]) };
  m = SAMPLE_LINE.exec(line);
  if (m) return { kind: 'sample', at, height: Number(m[1]), peerId: Number(m[2]) };
  if (SAMPLE_LINE_NO_BLOCKS.test(line)) return { kind: 'sampleNoBlocks', at };
  return { kind: 'other', at };
}

/**
 * The journald prefix carries the time twice (journald and bitcoind), about
 * 55 characters that push the interesting part out of view. Keep the local
 * clock time, drop the rest. A line that does not match stays as it is.
 */
const LOG_PREFIX =
  /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})[+-]\d{2}:?\d{2}\s+\S+\s+[\w.@-]+(?:\[\d+\])?:\s*(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\s+)?/;

export function shortenLogLine(line: string): string {
  const m = LOG_PREFIX.exec(line);
  if (m) return `${m[1]}  ${line.slice(m[0].length)}`;
  // a debug.log line: keep the clock time, drop date and Z
  const c = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z\s+/.exec(line);
  if (c) return `${c[1]}  ${line.slice(c[0].length)}`;
  return line;
}

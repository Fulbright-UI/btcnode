import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DebugLogReader } from './debugLog.js';
import { parseJournalLine, shortenLogLine } from './parse.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btcnode-debuglog-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const iso = (ago: number) => new Date(Date.now() - ago * 1000).toISOString().slice(0, 19) + 'Z';

describe('debug.log as the log source', () => {
  it('returns the newest lines of a file larger than one chunk, oldest first', async () => {
    const path = join(dir, 'debug.log');
    const lines = Array.from({ length: 5000 }, (_, i) => `${iso(5000 - i)} UpdateTip: line ${i}`);
    await writeFile(path, lines.join('\n') + '\n');
    const reader = new DebugLogReader(path, 4096); // small chunks: several reads
    const r = await reader.tail('ignored', 150);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(150);
    expect(r.lines[0]).toContain('line 4850');
    expect(r.lines[149]).toContain('line 4999');
  });

  it('gives only lines inside the window for since()', async () => {
    const path = join(dir, 'debug.log');
    const old = Array.from({ length: 300 }, (_, i) => `${iso(30 * 3600 + i)} old ${i}`);
    const fresh = Array.from({ length: 40 }, (_, i) => `${iso(3600 - i)} fresh ${i}`);
    await writeFile(path, [...old, ...fresh].join('\n') + '\n');
    const r = await new DebugLogReader(path, 2048).since('ignored', 25, 10_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(40);
    expect(r.lines.every((l) => l.includes('fresh'))).toBe(true);
  });

  it('reports a missing file instead of throwing', async () => {
    const r = await new DebugLogReader(join(dir, 'nope.log')).tail('x', 10);
    expect(r.ok).toBe(false);
  });

  it('is parsed like a journal line: Core timestamp, announcements, samples', () => {
    const line =
      '2026-09-07T18:17:51Z Saw new cmpctblock header hash=0000abc height=965079 peer=311';
    const p = parseJournalLine(line, 0);
    expect(p).toMatchObject({ kind: 'announce', height: 965079, peerId: 311 });
    expect(p.at).toBe(Date.parse('2026-09-07T18:17:51Z') / 1000);
    expect(shortenLogLine(line)).toBe(
      '18:17:51  Saw new cmpctblock header hash=0000abc height=965079 peer=311',
    );
    // -logtimemicros
    expect(
      parseJournalLine('2026-09-07T18:17:51.123456Z Bitcoin Core version v31.1.0', 0),
    ).toMatchObject({
      kind: 'start',
      at: Date.parse('2026-09-07T18:17:51Z') / 1000,
    });
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JournalReader } from '../journal/journalctl.js';
import { collectLog, renderLogText } from './log.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btcnode-log-'));
  await writeFile(join(dir, 'bitcoind.service'), '[Unit]\n');
  await writeFile(join(dir, 'electrs.service'), '[Unit]\n');
  await writeFile(join(dir, 'tor.service'), '[Unit]\n');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const journal: JournalReader = {
  async tail(unit) {
    if (unit === 'electrs') return { ok: false, error: 'permission denied' };
    if (unit === 'tor') return { ok: true, lines: [] };
    return {
      ok: true,
      lines: [
        '2026-09-06T14:04:16+02:00 btcnode bitcoind[1]: first',
        '2026-09-06T14:04:17+02:00 btcnode bitcoind[1]: second',
      ],
    };
  },
  async since() {
    return { ok: true, lines: [] };
  },
};

describe('log panel', () => {
  it('collects every unit newest first and names what went wrong', async () => {
    const sections = await collectLog(journal, ['bitcoind', 'electrs', 'tor', 'i2pd'], [dir], 10);
    expect(sections).toEqual([
      { unit: 'bitcoind', lines: ['14:04:17  second', '14:04:16  first'] },
      { unit: 'electrs', lines: [], problem: 'unreadable', detail: 'permission denied' },
      { unit: 'tor', lines: [], problem: 'empty' },
      { unit: 'i2pd', lines: [], problem: 'missingUnit' },
    ]);
    expect(renderLogText(sections)).toBe(
      [
        '--- bitcoind ---\n14:04:17  second\n14:04:16  first',
        '--- electrs ---\n[log not readable: permission denied]',
        '--- tor ---\n[no entries]',
        "--- i2pd ---\n[no unit 'i2pd' found]",
      ].join('\n\n'),
    );
  });

  it('reads a file source without looking for units', async () => {
    const sections = await collectLog(journal, ['debug.log'], null, 10);
    expect(renderLogText(sections)).toBe('14:04:17  second\n14:04:16  first');
  });

  it('says so when there is nothing to show', () => {
    expect(renderLogText([])).toBe('[no log source configured]');
    expect(renderLogText([{ unit: 'x', lines: [], problem: 'unreadable' }])).toBe(
      '[log not readable: no access to the journal]',
    );
  });
});

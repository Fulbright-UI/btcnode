import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecResult } from '../util/exec.js';

const calls: { file: string; args: string[] }[] = [];
let next: ExecResult = { code: 0, stdout: '', stderr: '' };

vi.mock('../util/exec.js', () => ({
  run: async (file: string, args: string[]) => {
    calls.push({ file, args });
    return next;
  },
}));

const { JournalctlReader } = await import('./journalctl.js');
const { NoUnitStatus, SystemctlUnitStatus } = await import('../collectors/units.js');

beforeEach(() => {
  calls.length = 0;
  next = { code: 0, stdout: '', stderr: '' };
});

describe('journalctl reader', () => {
  it('asks for the newest lines of a unit and drops empty ones', async () => {
    next = { code: 0, stdout: 'a\n\nb\n  \n', stderr: '' };
    expect(await new JournalctlReader().tail('bitcoind', 150)).toEqual({
      ok: true,
      lines: ['a', 'b'],
    });
    expect(calls[0]).toEqual({
      file: 'journalctl',
      args: ['-u', 'bitcoind', '--no-pager', '--output=short-iso', '--quiet', '-n', '150'],
    });
  });

  it('reads a mounted host journal with -D and a time window with --since', async () => {
    await new JournalctlReader('/host/journal').since('bitcoind', 24, 5000);
    expect(calls[0]?.args).toEqual([
      '-D',
      '/host/journal',
      '-u',
      'bitcoind',
      '--no-pager',
      '--output=short-iso',
      '--quiet',
      '--since',
      '-24h',
      '-n',
      '5000',
    ]);
  });

  it('reports journalctl errors, with its own words when it has any', async () => {
    next = { code: 1, stdout: '', stderr: 'No journal files were opened\n' };
    expect(await new JournalctlReader().tail('bitcoind', 5)).toEqual({
      ok: false,
      error: 'No journal files were opened',
    });
    next = { code: null, stdout: '', stderr: '' };
    expect(await new JournalctlReader().tail('bitcoind', 5)).toEqual({
      ok: false,
      error: 'journalctl exited with null',
    });
  });
});

describe('unit status from systemctl', () => {
  it('maps the exit code: 0 active, other inactive, none unknown', async () => {
    const units = new SystemctlUnitStatus();
    next = { code: 0, stdout: '', stderr: '' };
    expect(await units.isActive('electrs')).toBe(true);
    expect(calls[0]).toEqual({
      file: 'systemctl',
      args: ['is-active', '--quiet', 'electrs'],
    });
    next = { code: 3, stdout: '', stderr: '' };
    expect(await units.isActive('electrs')).toBe(false);
    next = { code: null, stdout: '', stderr: 'spawn systemctl ENOENT' };
    expect(await units.isActive('electrs')).toBeNull();
  });

  it('knows nothing without anybody to ask', async () => {
    expect(await new NoUnitStatus().isActive()).toBeNull();
  });
});

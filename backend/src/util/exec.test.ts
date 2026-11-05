import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { isIPv4 } from 'node:net';
import { describe, expect, it } from 'vitest';
import { portOpen, run } from './exec.js';
import { ownLanAddress } from './network.js';

const node = process.execPath;

describe('run', () => {
  it('returns exit code and both streams', async () => {
    const r = await run(node, ['-e', 'process.stdout.write("out");process.stderr.write("err")']);
    expect(r).toEqual({ code: 0, stdout: 'out', stderr: 'err' });
    const failed = await run(node, ['-e', 'process.exit(3)'], { timeoutMs: 10_000 });
    expect(failed.code).toBe(3);
  });

  it('never throws: a missing program or a timeout give code null', async () => {
    const missing = await run('btcnode-no-such-program', [], { timeoutMs: 5000 });
    expect(missing.code).toBeNull();
    expect(missing.stderr).not.toBe('');
    const slow = await run(node, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 200 });
    expect(slow.code).toBeNull();
  });

  it('stops a program that writes more than allowed', async () => {
    const r = await run(node, ['-e', 'process.stdout.write("x".repeat(100000))'], {
      timeoutMs: 10_000,
      maxBytes: 1000,
    });
    expect(r.code).toBeNull();
  });
});

describe('portOpen', () => {
  it('tells an open port from a closed one', async () => {
    const s = createServer((sock) => sock.destroy());
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const { port } = s.address() as AddressInfo;
    expect(await portOpen('127.0.0.1', port)).toBe(true);
    await new Promise<void>((r) => s.close(() => r()));
    expect(await portOpen('127.0.0.1', port)).toBe(false);
  });
});

describe('ownLanAddress', () => {
  it('names an IPv4 address or nothing, and never throws', async () => {
    const ip = await ownLanAddress();
    if (ip !== null) expect(isIPv4(ip)).toBe(true);
  });
});

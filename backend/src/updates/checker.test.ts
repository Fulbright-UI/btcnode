import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo, Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BitcoinRpcClient } from '../rpc/client.js';

/** What the fake https answers per URL: a body, an HTTP error, or a socket error. */
const answers = new Map<string, { status?: number; body?: string; error?: string }>();
const requested: { url: string; agent: unknown }[] = [];

vi.mock('node:https', () => ({
  request: (url: string, opts: { agent?: unknown }, onResponse: (res: unknown) => void) => {
    requested.push({ url, agent: opts.agent });
    const req = Object.assign(new EventEmitter(), {
      setTimeout: () => req,
      destroy: (err: Error) => req.emit('error', err),
      end: () => {
        const a = answers.get(url) ?? { error: 'ENOTFOUND' };
        setImmediate(() => {
          if (a.error) return void req.emit('error', new Error(a.error));
          const res = Object.assign(new EventEmitter(), {
            statusCode: a.status ?? 200,
            setEncoding: () => {},
            resume: () => {},
          });
          onResponse(res);
          if ((a.status ?? 200) < 400) {
            res.emit('data', a.body ?? '');
            res.emit('end');
          }
        });
      },
    });
    return req;
  },
}));

const { UpdateChecker, isNewer, versionFromText } = await import('./checker.js');

const CORE_RSS = 'https://bitcoincore.org/en/releasesrss.xml';
const ELECTRS_API = 'https://api.github.com/repos/romanz/electrs/releases/latest';
const rss = (...titles: string[]) =>
  `<rss><channel><title>Bitcoin Core</title>${titles.map((t) => `<item><title>${t}</title></item>`).join('')}</channel></rss>`;

const rpc = (subversion: string) =>
  ({ call: async () => ({ subversion }) }) as unknown as BitcoinRpcClient;

/** An Electrum server that answers server.version with the given software string. */
async function electrum(reply: string | null): Promise<{ port: number; server: Server }> {
  const server = createServer((sock) => {
    sock.on('error', () => {});
    sock.on('data', () => {
      if (reply === null) sock.end('not json\n');
      else sock.end(JSON.stringify({ jsonrpc: '2.0', id: 0, result: [reply, '1.4'] }) + '\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, server };
}

/** A port nobody listens on. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

let dir: string;
const servers: Server[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btcnode-updates-'));
  answers.clear();
  requested.length = 0;
});
afterEach(async () => {
  for (const s of servers.splice(0)) s.close();
  await rm(dir, { recursive: true, force: true });
});

describe('version comparison', () => {
  it('compares numerically and pads the shorter version', () => {
    expect(isNewer('31.10', '31.9')).toBe(true);
    expect(isNewer('31.1', '31.1.0')).toBe(false);
    expect(isNewer('31.1.1', '31.1')).toBe(true);
    expect(isNewer('30.2', '31.0')).toBe(false);
    expect(isNewer('31.x', '30')).toBe(false);
  });

  it('is a strict order: irreflexive, antisymmetric, blind to trailing zeros', () => {
    const version = fc
      .array(fc.nat({ max: 999 }), { minLength: 1, maxLength: 4 })
      .map((parts) => parts.join('.'));
    fc.assert(
      fc.property(version, version, (a, b) => {
        expect(isNewer(a, a)).toBe(false);
        expect(isNewer(a, b) && isNewer(b, a)).toBe(false);
        expect(isNewer(`${a}.0`, a)).toBe(false);
        if (a !== b && !isNewer(a, b) && !isNewer(b, a)) {
          // equal apart from trailing zeros
          expect(a.replace(/(\.0)+$/, '')).toBe(b.replace(/(\.0)+$/, ''));
        }
      }),
    );
  });

  it('finds the version in user agents, tags and titles', () => {
    expect(versionFromText('/Satoshi:31.1.0/')).toBe('31.1.0');
    expect(versionFromText('v0.11.1')).toBe('0.11.1');
    expect(versionFromText('Bitcoin Core 30.2 released')).toBe('30.2');
    expect(versionFromText('no version')).toBeNull();
    expect(versionFromText(null)).toBeNull();
  });
});

describe('weekly update check', () => {
  it('writes installed against latest, outdated only when the release is newer', async () => {
    answers.set(CORE_RSS, { body: rss('Bitcoin Core 31.2', 'Bitcoin Core 31.1') });
    answers.set(ELECTRS_API, { body: JSON.stringify({ tag_name: 'v0.11.1' }) });
    const e = await electrum('electrs/0.11.1');
    servers.push(e.server);
    const outFile = join(dir, 'sub', 'updates.json');
    const checker = new UpdateChecker({
      rpc: rpc('/Satoshi:31.1.0/'),
      outFile,
      electrumPort: e.port,
      log: pino({ level: 'silent' }),
    });
    const result = await checker.runOnce();
    expect(result).toMatchObject({
      viaTor: false,
      entries: [
        { name: 'Bitcoin Core', installed: '31.1', latest: '31.2', outdated: true },
        { name: 'electrs', installed: '0.11.1', latest: '0.11.1', outdated: false },
      ],
    });
    expect(JSON.parse(await readFile(outFile, 'utf8'))).toEqual(result);
    // no proxy configured: plain https
    expect(requested.every((r) => r.agent === undefined)).toBe(true);
  });

  it('keeps going without a latest version when the sources fail', async () => {
    answers.set(CORE_RSS, { status: 503 });
    answers.set(ELECTRS_API, { body: '{"message":"rate limited"}' });
    const e = await electrum('electrs/0.10.9');
    servers.push(e.server);
    const result = await new UpdateChecker({
      rpc: rpc('/Satoshi:31.1.0/'),
      outFile: join(dir, 'updates.json'),
      electrumPort: e.port,
      log: pino({ level: 'silent' }),
    }).runOnce();
    expect(result?.entries).toEqual([
      { name: 'Bitcoin Core', installed: '31.1', latest: null, outdated: false },
      { name: 'electrs', installed: '0.10.9', latest: null, outdated: false },
    ]);
  });

  it('skips electrs when nothing answers on its port or the answer is garbage', async () => {
    answers.set(CORE_RSS, { body: rss('Bitcoin Core 31.1') });
    const garbage = await electrum(null);
    servers.push(garbage.server);
    for (const port of [await closedPort(), garbage.port]) {
      const result = await new UpdateChecker({
        rpc: rpc('/Satoshi:31.1.0/'),
        outFile: join(dir, 'updates.json'),
        electrumPort: port,
        log: pino({ level: 'silent' }),
      }).runOnce();
      expect(result?.entries.map((x) => x.name)).toEqual(['Bitcoin Core']);
    }
    expect(requested.map((r) => r.url)).not.toContain(ELECTRS_API);
  });

  it('goes through Tor when the proxy port is open, directly otherwise', async () => {
    answers.set(CORE_RSS, { body: rss('Bitcoin Core 31.1') });
    const proxy = createServer((s) => s.destroy());
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    servers.push(proxy);
    const opts = {
      rpc: rpc('/Satoshi:31.1.0/'),
      outFile: join(dir, 'updates.json'),
      electrumPort: await closedPort(),
      log: pino({ level: 'silent' }),
    };
    const open = `socks5h://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    expect((await new UpdateChecker({ ...opts, torProxy: open }).runOnce())?.viaTor).toBe(true);
    expect(requested.at(-1)?.agent).toBeDefined();

    const closed = `socks5h://127.0.0.1:${await closedPort()}`;
    expect((await new UpdateChecker({ ...opts, torProxy: closed }).runOnce())?.viaTor).toBe(false);
    expect(requested.at(-1)?.agent).toBeUndefined();
  });

  it('runs on its timer and stops', async () => {
    vi.useFakeTimers();
    try {
      const checker = new UpdateChecker({
        rpc: { call: async () => Promise.reject(new Error('down')) } as unknown as BitcoinRpcClient,
        outFile: join(dir, 'updates.json'),
        electrumPort: 1,
        log: pino({ level: 'silent' }),
        intervalMs: 1000,
      });
      const run = vi.spyOn(checker, 'runOnce');
      checker.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
      checker.stop();
      const calls = run.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(run.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});

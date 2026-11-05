import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import type { AddressInfo, Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ElectrumCollector, headersSubscribe, indexHeightFromMetrics } from './electrum.js';

const servers: { close: (cb: () => void) => void }[] = [];
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btcnode-electrum-'));
});
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

/** An Electrum port that writes the given text once a request arrives. */
async function electrumPort(answer: string | null): Promise<number> {
  const s: Server = createTcpServer((sock) => {
    sock.on('error', () => {}); // the client hangs up early on purpose
    sock.on('data', () => {
      if (answer !== null) sock.write(answer);
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return (s.address() as AddressInfo).port;
}

async function metrics(body: string): Promise<string> {
  const s = createServer((_req, res) => res.end(body));
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/`;
}

async function closedPort(): Promise<number> {
  const s = createTcpServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('electrs metrics', () => {
  it('prefers electrs_index_height and falls back to any height metric', () => {
    expect(
      indexHeightFromMetrics(
        [
          '# HELP electrs_index_height',
          'electrs_index_height{type="tip"} 915309',
          'electrs_index_height{type="other"} 915000',
          'some_height 999999',
        ].join('\n'),
      ),
    ).toBe(915309);
    expect(indexHeightFromMetrics('block_height 1.5e3\nunrelated 7\n')).toBe(1500);
    expect(indexHeightFromMetrics('unrelated 7\n# comment\n\n!!garbage')).toBeNull();
  });

  it('finds the height in any exposition that carries it', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000_000 }),
        fc.array(
          fc.string({ maxLength: 40 }).filter((s) => !s.includes('height')),
          {
            maxLength: 10,
          },
        ),
        (height, noise) => {
          const text = [...noise, `electrs_index_height{type="tip"} ${height}`].join('\n');
          expect(indexHeightFromMetrics(text)).toBe(height);
        },
      ),
    );
  });
});

describe('headers.subscribe on the Electrum port', () => {
  it('reads the height of a valid answer', async () => {
    const port = await electrumPort('{"jsonrpc":"2.0","id":0,"result":{"height":915312}}\n');
    expect(await headersSubscribe(port)).toBe(915312);
  });

  it('answers null for errors, nonsense, zero and a closed port', async () => {
    expect(await headersSubscribe(await electrumPort('{"error":"busy"}\n'))).toBeNull();
    expect(await headersSubscribe(await electrumPort('{"result":{"height":0}}\n'))).toBeNull();
    expect(await headersSubscribe(await electrumPort('not json\n'))).toBeNull();
    expect(await headersSubscribe(await closedPort())).toBeNull();
  });

  it('gives up on an answer without a line end once it is too long', async () => {
    expect(await headersSubscribe(await electrumPort('x'.repeat(70_000)))).toBeNull();
  });
});

describe('Electrum collector', () => {
  const opts = async (over: Partial<ConstructorParameters<typeof ElectrumCollector>[0]> = {}) => {
    const unitDir = join(dir, 'units');
    await mkdir(unitDir, { recursive: true });
    return {
      port: await closedPort(),
      metricsUrl: `http://127.0.0.1:${await closedPort()}/`,
      onionFile: join(dir, 'onion'),
      unit: 'electrs',
      unitDirs: [unitDir],
      ...over,
    };
  };
  const lan = async () => '10.0.0.5';

  it('reports a host without electrs as not configured, without asking anything', async () => {
    let asked = false;
    const c = new ElectrumCollector(
      await opts(),
      {
        isActive: async () => {
          asked = true;
          return true;
        },
      },
      lan,
    );
    expect(await c.collect(100)).toMatchObject({
      configured: false,
      running: false,
      reachable: false,
      lanAddress: null,
      onionAddress: null,
    });
    expect(asked).toBe(false);
  });

  it('falls back to the Electrum port when the metrics are not there', async () => {
    const port = await electrumPort('{"result":{"height":99}}\n');
    const o = await opts({ port });
    await writeFile(join(dir, 'onion'), 'electrsexample.onion\n');
    const c = new ElectrumCollector(o, { isActive: async () => null }, lan);
    expect(await c.collect(100)).toMatchObject({
      configured: true,
      knownByUnit: false,
      running: true,
      reachable: true,
      indexedHeight: 99,
      indexReadable: true,
      lanAddress: `10.0.0.5:${port}`,
      onionAddress: `electrsexample.onion:${port}`,
    });
  });

  it('distrusts an index above the node and believes the unit over the port', async () => {
    const o = await opts({
      port: await electrumPort('{}\n'),
      metricsUrl: await metrics('electrs_index_height 120\n'),
    });
    await writeFile(join(o.unitDirs[0]!, 'electrs.service'), '[Unit]\n');
    const ahead = new ElectrumCollector(o, { isActive: async () => true }, async () => null);
    expect(await ahead.collect(100)).toMatchObject({
      knownByUnit: true,
      indexedHeight: null,
      indexReadable: false,
      lanAddress: null,
    });
    const stopped = new ElectrumCollector(o, { isActive: async () => false }, lan);
    expect(await stopped.collect(100)).toMatchObject({
      running: false,
      reachable: true,
      indexedHeight: null,
    });
  });
});

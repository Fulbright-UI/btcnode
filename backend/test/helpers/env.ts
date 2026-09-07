import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ElectrumCollector } from '../../src/collectors/electrum.js';
import type { UnitStatusProvider } from '../../src/collectors/electrum.js';
import { PeerCollector } from '../../src/collectors/peers.js';
import { SystemCollector } from '../../src/collectors/system.js';
import { loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import { BlockTraffic } from '../../src/history/blockTraffic.js';
import { TemperatureHistory } from '../../src/history/temperature.js';
import { AnnouncementTracker } from '../../src/journal/announcements.js';
import { BitcoinRpcClient } from '../../src/rpc/client.js';
import { Poller } from '../../src/state/poller.js';
import { FakeJournal, journalLines } from './fixtures.js';
import { MockNode } from './mockNode.js';
import type { MockNodeOptions } from './mockNode.js';

export interface TestEnv {
  node: MockNode;
  poller: Poller;
  journal: FakeJournal;
  config: Config;
  rpc: BitcoinRpcClient;
  electrs: { running: boolean; height: number };
  /** The fake host tree (proc/, temp, hwmon/, …) */
  hostRoot: string;
  stop: () => Promise<void>;
}

/** A fake electrs: Electrum protocol on one port, Prometheus metrics on another. */
async function fakeElectrs(state: { running: boolean; height: number }) {
  const tcp = createTcpServer((sock) => {
    sock.on('data', (chunk) => {
      const req = JSON.parse(chunk.toString()) as { id: number; method: string };
      const result =
        req.method === 'server.version'
          ? ['electrs/0.11.1', '1.4']
          : { height: state.height, hex: '00' };
      sock.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
    });
  });
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
  const http = createHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`# HELP electrs_index_height\nelectrs_index_height{type="tip"} ${state.height}\n`);
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  return {
    port: (tcp.address() as AddressInfo).port,
    metricsUrl: `http://127.0.0.1:${(http.address() as AddressInfo).port}/`,
    stop: async () => {
      tcp.close();
      http.close();
    },
  };
}

/** A host-like tree: /proc, thermal, hwmon with rpi_volt, a unit directory. */
async function fakeHost(tip: number) {
  const root = await mkdtemp(join(tmpdir(), 'btcnode-'));
  const proc = join(root, 'proc');
  await mkdir(proc);
  await writeFile(join(proc, 'stat'), 'cpu  10000 0 3000 40000 500 0 0 0 0 0\n');
  await writeFile(
    join(proc, 'meminfo'),
    'MemTotal:        4000000 kB\nMemAvailable:    3600000 kB\n',
  );
  await writeFile(join(proc, 'uptime'), '812.34 3000.0\n');
  await writeFile(join(root, 'temp'), '69600');
  const hwmon = join(root, 'hwmon', 'hwmon2');
  await mkdir(hwmon, { recursive: true });
  await writeFile(join(hwmon, 'name'), 'rpi_volt\n');
  await writeFile(join(hwmon, 'in0_lcrit_alarm'), '0\n');
  const units = join(root, 'usr', 'lib', 'systemd', 'system');
  await mkdir(units, { recursive: true });
  await writeFile(join(units, 'bitcoind.service'), '[Unit]\n');
  await writeFile(join(units, 'electrs.service'), '[Unit]\n');
  await writeFile(
    join(root, 'onion'),
    'electrsonionelectrsonionelectrsonionelectrsonionelectrsonio.onion\n',
  );
  await writeFile(
    join(root, 'updates.json'),
    JSON.stringify({
      checkedAt: Math.floor(Date.now() / 1000) - 1260,
      viaTor: false,
      entries: [
        { name: 'Bitcoin Core', installed: '31.1', latest: '31.1', outdated: false },
        { name: 'electrs', installed: '0.11.1', latest: '0.11.1', outdated: false },
      ],
    }),
  );
  return { root, proc, units, tip };
}

export async function createEnv(
  opts: MockNodeOptions & { electrsRunning?: boolean; electrsBehind?: number } = {},
): Promise<TestEnv> {
  const node = new MockNode(opts);
  const url = await node.start();
  const host = await fakeHost(node.tip);
  const electrsState = {
    running: opts.electrsRunning ?? true,
    height: node.tip - (opts.electrsBehind ?? 3),
  };
  const electrs = await fakeElectrs(electrsState);

  const config = loadConfig({
    NODE_ENV: 'test',
    BITCOIN_RPC_URL: url,
    BITCOIN_RPC_PASSWORD: 'secret-7f3a',
    BITCOIN_RPC_TIMEOUT: '5',
    BITCOIN_DATA_DIR: host.root,
    STATUS_INTERVAL: '21',
    LOG_INTERVAL: '3',
    ELECTRUM_PORT: String(electrs.port),
    ELECTRS_METRICS_URL: electrs.metricsUrl,
    ELECTRS_ONION_FILE: join(host.root, 'onion'),
    SYSTEMD_UNIT_DIRS: host.units,
    UPDATES_FILE: join(host.root, 'updates.json'),
    SYSFS_THERMAL: join(host.root, 'temp'),
    SYSFS_HWMON: join(host.root, 'hwmon'),
    PROC_DIR: host.proc,
    HOSTNAME: 'testnode',
  });

  const rpc = new BitcoinRpcClient({
    url: config.BITCOIN_RPC_URL,
    user: config.BITCOIN_RPC_USER,
    password: config.rpcPassword,
    timeoutSeconds: config.BITCOIN_RPC_TIMEOUT,
  });
  const journal = new FakeJournal(journalLines(node.tip));
  const units: UnitStatusProvider = { isActive: async () => electrsState.running };
  const poller = new Poller({
    config,
    log: pino({ level: 'silent' }),
    rpc,
    journal,
    announcements: new AnnouncementTracker(journal, 'bitcoind'),
    peers: new PeerCollector(rpc, new BlockTraffic(), config.PEERS_MAX),
    system: new SystemCollector(
      {
        procDir: host.proc,
        thermalFile: join(host.root, 'temp'),
        hwmonDir: join(host.root, 'hwmon'),
        dataDir: host.root,
      },
      new TemperatureHistory(),
    ),
    electrum: new ElectrumCollector(
      {
        port: electrs.port,
        metricsUrl: electrs.metricsUrl,
        onionFile: join(host.root, 'onion'),
        unit: 'electrs',
        unitDirs: [host.units],
      },
      units,
      async () => '192.168.1.50',
    ),
    chronicleEntries: [
      {
        date: '2008-10-31',
        who: 'Satoshi Nakamoto',
        text: "I've been working on a new electronic cash system",
      },
      {
        date: '2009-01-03',
        who: 'Genesis block',
        text: 'Chancellor on brink of second bailout for banks',
      },
    ],
    version: '4.0.0-test',
  });

  return {
    node,
    poller,
    journal,
    config,
    rpc,
    electrs: electrsState,
    hostRoot: host.root,
    stop: async () => {
      poller.stop();
      await electrs.stop();
      await node.stop();
    },
  };
}

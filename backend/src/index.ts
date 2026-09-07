import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chronicleEntrySchema } from '@btcnode/shared';
import pino from 'pino';
import { z } from 'zod';
import { buildApp } from './app.js';
import { ElectrumCollector } from './collectors/electrum.js';
import { PeerCollector } from './collectors/peers.js';
import { SystemCollector } from './collectors/system.js';
import { NoUnitStatus, SystemctlUnitStatus } from './collectors/units.js';
import { loadConfig } from './config.js';
import { AgentClient, AgentUnitStatus } from './control/agentClient.js';
import { BlockTraffic } from './history/blockTraffic.js';
import { TemperatureHistory } from './history/temperature.js';
import { AnnouncementTracker } from './journal/announcements.js';
import { JournalctlReader } from './journal/journalctl.js';
import { BitcoinRpcClient } from './rpc/client.js';
import { Poller } from './state/poller.js';
import { UpdateChecker } from './updates/checker.js';
import { ownLanAddress } from './util/network.js';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();
  const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8')) as {
    version: string;
  };
  const chronicle = z
    .array(chronicleEntrySchema)
    .parse(JSON.parse(await readFile(join(here, '..', 'data', 'chronicle.json'), 'utf8')))
    .sort((a, b) => a.date.localeCompare(b.date));

  const rpc = new BitcoinRpcClient({
    url: config.BITCOIN_RPC_URL,
    user: config.BITCOIN_RPC_USER,
    password: config.rpcPassword,
    timeoutSeconds: config.BITCOIN_RPC_TIMEOUT,
  });
  const journal = new JournalctlReader(config.JOURNAL_DIR);
  const agent = config.AGENT_SOCKET ? new AgentClient(config.AGENT_SOCKET) : null;
  const units = agent
    ? new AgentUnitStatus(agent)
    : config.JOURNAL_DIR
      ? new NoUnitStatus()
      : new SystemctlUnitStatus();

  const poller = new Poller({
    config,
    log: pino({ level: config.LOG_LEVEL }),
    rpc,
    journal,
    announcements: new AnnouncementTracker(journal, config.logUnits[0] ?? 'bitcoind'),
    peers: new PeerCollector(rpc, new BlockTraffic(), config.PEERS_MAX),
    system: new SystemCollector(
      {
        procDir: config.PROC_DIR,
        thermalFile: config.SYSFS_THERMAL,
        hwmonDir: config.SYSFS_HWMON,
        dataDir: config.BITCOIN_DATA_DIR,
      },
      new TemperatureHistory(),
    ),
    electrum: new ElectrumCollector(
      {
        port: config.ELECTRUM_PORT,
        metricsUrl: config.ELECTRS_METRICS_URL,
        onionFile: config.ELECTRS_ONION_FILE,
        unit: config.ELECTRS_UNIT,
        unitDirs: config.unitDirs,
      },
      units,
      ownLanAddress,
    ),
    chronicleEntries: chronicle,
    version: pkg.version,
  });

  const app = await buildApp({
    source: poller,
    agent,
    adminPasswordHash: config.adminPasswordHash,
    sessionKey: config.sessionKey,
    secureCookie: config.SESSION_SECURE_COOKIE,
    logLevel: config.LOG_LEVEL,
    trustProxy: true,
  });

  if (config.UPDATE_CHECK) {
    const checker = new UpdateChecker({
      rpc,
      outFile: config.UPDATES_FILE,
      torProxy: config.UPDATE_CHECK_TOR_PROXY,
      electrumPort: config.ELECTRUM_PORT,
      log: app.log,
    });
    checker.start();
    app.addHook('onClose', async () => checker.stop());
  }

  poller.start();
  app.addHook('onClose', async () => poller.stop());

  const shutdown = () => {
    app.log.info('shutting down');
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(
    {
      control: agent !== null,
      updateCheck: config.UPDATE_CHECK,
      journalDir: config.JOURNAL_DIR ?? 'default',
    },
    `btcnode backend ${pkg.version} listening`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

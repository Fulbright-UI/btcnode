/**
 * A complete dashboard against a mock node — for development without a Pi
 * and for the visual check. Starts the mock bitcoind, a fake electrs, a fake
 * host tree, the real backend on top, and serves the built frontend from
 * ../frontend/dist on the same port.
 *
 *   pnpm --filter ./backend mock            # http://127.0.0.1:3000/
 *   MOCK_SCENARIO=syncing pnpm ... mock     # the initial sync
 *   MOCK_SCENARIO=empty pnpm ... mock       # a node with nothing
 */
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { AgentClient, AgentUnitStatus } from '../src/control/agentClient.js';
import { createEnv } from './helpers/env.js';
import { fakeAgent } from './helpers/fakeAgent.js';
import type { Scenario } from './helpers/mockNode.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = (process.env.MOCK_SCENARIO ?? 'synced') as Scenario;
const port = Number(process.env.PORT ?? 3000);

const env = await createEnv({
  scenario,
  electrsBehind: Number(process.env.MOCK_ELECTRS_BEHIND ?? 3),
});
// A CPU that does something: /proc/stat must move between two passes.
let jiffies = 10_000;
const ticker = setInterval(() => {
  jiffies += 100;
  void writeFile(
    join(env.hostRoot, 'proc', 'stat'),
    `cpu  ${jiffies} 0 ${Math.floor(jiffies / 3)} ${jiffies * 2} 500 0 0 0 0 0\n`,
  );
}, 1000);
env.poller.start();
// The control panel against a fake agent; password "mock-password".
const agent = await fakeAgent();

const agentClient = new AgentClient(agent.path);
const agentStatus = new AgentUnitStatus(agentClient);
const app = await buildApp({
  source: env.poller,
  agent: agentClient,
  agentActions: () => agentStatus.actions(),
  adminPasswordHash: await hashPassword('mock-password'),
  sessionKey: randomBytes(32),
  secureCookie: false,
  logLevel: 'warn',
});
await app.register(fastifyStatic, {
  root: join(here, '..', '..', 'frontend', 'dist'),
  wildcard: false,
});
app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
  return reply.sendFile('index.html');
});

await app.listen({ host: '127.0.0.1', port });
console.log(`mock dashboard (${scenario}) at http://127.0.0.1:${port}/`);

const stop = async () => {
  clearInterval(ticker);
  await app.close();
  await agent.stop();
  await env.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

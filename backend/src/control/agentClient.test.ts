import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { CONTROL_ACTIONS } from '@btcnode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentClient, AgentUnitStatus } from './agentClient.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** A socket path that works on Linux and, as a named pipe, on Windows. */
async function socketPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-'));
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\btcnode-${basename(dir)}`
    : join(dir, 'agent.sock');
}

/** An agent whose behaviour per connection the test decides. */
async function agent(onLine: (line: string, sock: Socket) => void) {
  const path = await socketPath();
  const lines: string[] = [];
  const server = createServer((sock) => {
    sock.on('error', () => {});
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      lines.push(line);
      onLine(line, sock);
    });
  });
  await new Promise<void>((r) => server.listen(path, r));
  servers.push(server);
  return { path, lines };
}

describe('agent client', () => {
  it('sends one JSON line and reads an answer that arrives in pieces', async () => {
    const a = await agent((_line, sock) => {
      sock.write('{"ok":true,');
      setTimeout(() => sock.end('"message":"restarted"}\n'), 10);
    });
    const reply = await new AgentClient(a.path).run('restart-bitcoind');
    expect(reply).toEqual({ ok: true, message: 'restarted' });
    expect(a.lines).toEqual(['{"action":"restart-bitcoind"}']);
  });

  it('rejects an answer outside the contract', async () => {
    const a = await agent((_line, sock) => sock.end('{"ok":"yes"}\n'));
    await expect(new AgentClient(a.path).status()).rejects.toThrow();
    const b = await agent((_line, sock) => sock.end('not json\n'));
    await expect(new AgentClient(b.path).status()).rejects.toThrow();
  });

  it('rejects when the agent hangs up without a full line', async () => {
    const a = await agent((_line, sock) => sock.end('{"ok":true'));
    await expect(new AgentClient(a.path).status()).rejects.toThrow(/closed the connection/);
  });

  it('gives up after its timeout', async () => {
    const a = await agent(() => {});
    await expect(new AgentClient(a.path, 50).status()).rejects.toThrow(/timed out/);
  });

  it('rejects when nobody listens', async () => {
    await expect(new AgentClient(await socketPath()).status()).rejects.toThrow();
  });
});

describe('unit status through the agent', () => {
  it('maps unit states and caches the answer for its lifetime', async () => {
    const a = await agent((_line, sock) =>
      sock.end(
        JSON.stringify({
          ok: true,
          units: { bitcoind: 'active', electrs: 'failed', tor: 'unknown' },
          available: ['reboot', 'restart-bitcoind', 'something-new'],
        }) + '\n',
      ),
    );
    const units = new AgentUnitStatus(new AgentClient(a.path), 60_000);
    expect(await units.isActive('bitcoind')).toBe(true);
    expect(await units.isActive('electrs')).toBe(false);
    expect(await units.isActive('tor')).toBeNull();
    expect(await units.isActive('i2pd')).toBeNull();
    // the contract's order, unknown actions dropped
    expect(await units.actions()).toEqual(['restart-bitcoind', 'reboot']);
    expect(a.lines).toHaveLength(1);
  });

  it('asks again once the cache has expired', async () => {
    const a = await agent((_line, sock) => sock.end('{"ok":true,"units":{}}\n'));
    const units = new AgentUnitStatus(new AgentClient(a.path), -1);
    await units.isActive('bitcoind');
    await units.isActive('bitcoind');
    expect(a.lines).toHaveLength(2);
  });

  it('offers every action when the agent is old or unreachable, and knows no state', async () => {
    const old = await agent((_line, sock) => sock.end('{"ok":true,"units":{}}\n'));
    expect(await new AgentUnitStatus(new AgentClient(old.path)).actions()).toEqual([
      ...CONTROL_ACTIONS,
    ]);
    const gone = new AgentUnitStatus(new AgentClient(await socketPath()));
    expect(await gone.actions()).toEqual([...CONTROL_ACTIONS]);
    expect(await gone.isActive('bitcoind')).toBeNull();
  });
});

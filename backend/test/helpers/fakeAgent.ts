import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fake host agent on a Unix socket that records what it was asked.
 * `electrs: 'missing'` plays a host without an Electrum server — the
 * agent then does not offer its restart.
 */
export async function fakeAgent(opts: { electrs?: 'active' | 'missing' } = {}) {
  const electrs = opts.electrs ?? 'active';
  const dir = await mkdtemp(join(tmpdir(), 'agent-'));
  const path = join(dir, 'agent.sock');
  const asked: string[] = [];
  const server: Server = createServer((sock) => {
    sock.on('data', (chunk) => {
      const req = JSON.parse(chunk.toString()) as { action: string };
      asked.push(req.action);
      if (req.action === 'status') {
        sock.end(
          JSON.stringify({
            ok: true,
            units: { bitcoind: 'active', electrs },
            available: ['poweroff', 'reboot', 'restart-bitcoind'].concat(
              electrs === 'missing' ? [] : ['restart-electrs'],
            ),
          }) + '\n',
        );
      } else if (req.action === 'restart-bitcoind' || req.action === 'restart-electrs') {
        sock.end(JSON.stringify({ ok: true, message: `${req.action} done` }) + '\n');
      } else {
        sock.end(JSON.stringify({ ok: false, message: 'refused by the fake agent' }) + '\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(path, r));
  return { path, asked, stop: () => new Promise<void>((r) => server.close(() => r())) };
}

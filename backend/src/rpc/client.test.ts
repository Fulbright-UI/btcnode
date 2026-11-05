import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BitcoinRpcClient, RpcError } from './client.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** A node that answers every call with what `reply` returns for its method. */
async function node(
  reply: (method: string, req: IncomingMessage) => { status?: number; body: string },
): Promise<{ url: string; asked: string[] }> {
  const asked: string[] = [];
  const s = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const { method } = JSON.parse(body) as { method: string };
      asked.push(method);
      const r = reply(method, req);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(r.body);
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/`, asked };
}

const client = (
  url: string,
  over: Partial<ConstructorParameters<typeof BitcoinRpcClient>[0]> = {},
) => new BitcoinRpcClient({ url, user: 'dashboard', password: 'pw', timeoutSeconds: 5, ...over });

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    expect(err).toBeInstanceOf(RpcError);
    return (err as RpcError).kind;
  }
}

describe('RPC client', () => {
  it('sends basic auth and returns the checked result', async () => {
    let auth = '';
    const n = await node((_m, req) => {
      auth = req.headers.authorization ?? '';
      return { body: '{"result":{"blocks":7},"error":null}' };
    });
    const c = client(n.url);
    expect(await c.call('getblockcount', [], z.object({ blocks: z.number() }))).toEqual({
      blocks: 7,
    });
    expect(await c.call('getblockcount')).toEqual({ blocks: 7 });
    expect(auth).toBe('Basic ' + Buffer.from('dashboard:pw').toString('base64'));
    expect(await kindOf(c.call('getblockcount', [], z.object({ blocks: z.string() })))).toBe('rpc');
  });

  it('tells login, warmup, node errors and garbage apart', async () => {
    const answers: Record<string, { status?: number; body: string }> = {
      login: { status: 401, body: '' },
      warmup: { status: 500, body: '{"result":null,"error":{"code":-28,"message":"Loading"}}' },
      failing: { status: 500, body: '{"result":null,"error":{"code":-1,"message":"boom"}}' },
      garbage: { body: '<html>' },
      envelope: { body: '{"nothing":1}' },
      http: { status: 502, body: '{"result":1}' },
    };
    const n = await node((m) => answers[m]!);
    const c = client(n.url);
    expect(await kindOf(c.call('login'))).toBe('auth');
    expect(await kindOf(c.call('warmup'))).toBe('warmup');
    await expect(c.call('failing')).rejects.toThrow('failing: boom');
    expect(await kindOf(c.call('garbage'))).toBe('rpc');
    expect(await kindOf(c.call('envelope'))).toBe('rpc');
    expect(await kindOf(c.call('http'))).toBe('rpc');
  });

  it('does not ask again for a refused method until the retry time has passed', async () => {
    let now = 1000;
    const n = await node((m) =>
      m === 'getpeerinfo' ? { status: 403, body: '' } : { body: '{"result":1}' },
    );
    const c = client(n.url, { now: () => now, deniedRetryAfter: 60 });
    expect(await kindOf(c.call('getpeerinfo'))).toBe('denied');
    expect(await kindOf(c.call('getpeerinfo'))).toBe('denied');
    expect(c.isDenied('getpeerinfo')).toBe(true);
    expect(n.asked).toEqual(['getpeerinfo']);
    // other methods are not affected
    expect(await c.call('getblockcount')).toBe(1);
    now += 60;
    expect(c.isDenied('getpeerinfo')).toBe(false);
    expect(await kindOf(c.call('getpeerinfo'))).toBe('denied');
    expect(n.asked.filter((m) => m === 'getpeerinfo')).toHaveLength(2);
  });

  it('refuses an answer above the size limit and an unreachable node', async () => {
    const n = await node(() => ({ body: JSON.stringify({ result: 'x'.repeat(5000) }) }));
    expect(await kindOf(client(n.url, { maxBodyBytes: 1000 }).call('big'))).toBe('rpc');
    const gone = await node(() => ({ body: '' }));
    await new Promise<void>((r) => servers.pop()!.close(() => r()));
    expect(await kindOf(client(gone.url).call('getblockcount'))).toBe('unreachable');
  });
});

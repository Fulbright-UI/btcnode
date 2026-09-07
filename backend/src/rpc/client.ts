import { request } from 'undici';
import type { z } from 'zod';

export class RpcError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'auth' | 'denied' | 'warmup' | 'rpc',
    readonly method: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface RpcClientOptions {
  url: string;
  user: string;
  password: string;
  /** Per-call timeout, seconds */
  timeoutSeconds: number;
  /** Methods the node refused (HTTP 403) are not asked again for this long, seconds */
  deniedRetryAfter?: number;
  /** Largest answer accepted, bytes */
  maxBodyBytes?: number;
  now?: () => number;
}

const RPC_IN_WARMUP = -28;

/**
 * A minimal JSON-RPC 1.0 client for Bitcoin Core. It remembers what the node
 * refused — with `rpcwhitelist` a forbidden method would otherwise be asked
 * every cycle, and bitcoind writes a line into the very log the page shows.
 */
export class BitcoinRpcClient {
  private readonly denied = new Map<string, number>();
  private readonly auth: string;
  private readonly now: () => number;

  constructor(private readonly opts: RpcClientOptions) {
    this.auth = 'Basic ' + Buffer.from(`${opts.user}:${opts.password}`).toString('base64');
    this.now = opts.now ?? (() => Date.now() / 1000);
  }

  isDenied(method: string): boolean {
    const at = this.denied.get(method);
    if (at === undefined) return false;
    if (this.now() - at >= (this.opts.deniedRetryAfter ?? 1800)) {
      this.denied.delete(method);
      return false;
    }
    return true;
  }

  async call<T>(method: string, params: unknown[] = [], schema?: z.ZodType<T>): Promise<T> {
    if (this.isDenied(method)) {
      throw new RpcError(`${method} is not allowed (rpcwhitelist)`, 'denied', method);
    }
    let res;
    try {
      res = await request(this.opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: this.auth },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'btcnode', method, params }),
        headersTimeout: this.opts.timeoutSeconds * 1000,
        bodyTimeout: this.opts.timeoutSeconds * 1000,
      });
    } catch (err) {
      throw new RpcError(`Node not reachable: ${(err as Error).message}`, 'unreachable', method);
    }

    const body = await readBounded(res.body, this.opts.maxBodyBytes ?? 16_000_000);
    if (res.statusCode === 401) {
      throw new RpcError('Node refused the login (HTTP 401)', 'auth', method);
    }
    if (res.statusCode === 403) {
      this.denied.set(method, this.now());
      throw new RpcError(`${method} is not allowed (HTTP 403)`, 'denied', method);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new RpcError(
        `Unreadable answer from ${method} (HTTP ${res.statusCode})`,
        'rpc',
        method,
      );
    }
    if (typeof parsed !== 'object' || parsed === null || !('result' in parsed)) {
      throw new RpcError(`Unreadable answer from ${method}`, 'rpc', method);
    }
    const envelope = parsed as {
      result: unknown;
      error?: { code?: number; message?: string } | null;
    };
    if (envelope.error) {
      // Core answers HTTP 500 while starting; the body says what it is doing.
      if (envelope.error.code === RPC_IN_WARMUP) {
        throw new RpcError(envelope.error.message ?? 'Node in warmup', 'warmup', method);
      }
      throw new RpcError(`${method}: ${envelope.error.message ?? 'error'}`, 'rpc', method);
    }
    if (res.statusCode >= 400) {
      throw new RpcError(`HTTP ${res.statusCode} on ${method}`, 'rpc', method);
    }
    if (!schema) return envelope.result as T;
    const checked = schema.safeParse(envelope.result);
    if (!checked.success) {
      throw new RpcError(
        `Unexpected shape from ${method}: ${checked.error.message}`,
        'rpc',
        method,
      );
    }
    return checked.data;
  }
}

async function readBounded(body: AsyncIterable<Uint8Array>, limit: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) throw new RpcError('Answer too large', 'rpc', '');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

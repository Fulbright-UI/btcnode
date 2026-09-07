import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { request as httpsRequest } from 'node:https';
import type { Agent } from 'node:https';
import type { StatusSnapshot } from '@btcnode/shared';
import type { FastifyBaseLogger } from 'fastify';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { z } from 'zod';
import type { BitcoinRpcClient } from '../rpc/client.js';
import { networkInfoSchema } from '../rpc/schemas.js';
import { portOpen } from '../util/exec.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 45_000;

export interface UpdateCheckerOptions {
  rpc: BitcoinRpcClient;
  outFile: string;
  /** socks5h://host:port — used when reachable, so the home IP never shows up at GitHub */
  torProxy?: string | undefined;
  electrumPort: number;
  log: FastifyBaseLogger;
  intervalMs?: number;
}

/** '31.10' > '31.9' — compare as numbers, padded to equal length. */
export function isNewer(candidate: string, installed: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = installed.split('.').map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function versionFromText(text: string | null | undefined): string | null {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(text ?? '');
  return m ? m[1]! : null;
}

/** Trailing ".0" trimmed so "31.1.0" and "31.1" compare as the same release. */
function normalize(v: string): string {
  return v.replace(/(\.0)+$/, '');
}

function fetchText(url: string, agent?: Agent): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': 'btcnode-updatecheck', accept: '*/*' },
        ...(agent ? { agent } : {}),
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          body += c;
          if (body.length > 2_000_000) req.destroy(new Error('answer too large'));
        });
        res.on('end', () => resolve(body));
      },
    );
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

const githubRelease = z.object({ tag_name: z.string() });

/** Ask the Electrum server its own version — works from inside a container, unlike `electrs --version`. */
function electrumServerVersion(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    let buf = '';
    const done = (v: string | null) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(5000, () => done(null));
    sock.once('error', () => done(null));
    sock.once('connect', () =>
      sock.write('{"jsonrpc":"2.0","id":0,"method":"server.version","params":["btcnode","1.4"]}\n'),
    );
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      try {
        const r = JSON.parse(buf.slice(0, nl)) as { result?: unknown };
        const first = Array.isArray(r.result) ? r.result[0] : null;
        done(typeof first === 'string' ? versionFromText(first) : null);
      } catch {
        done(null);
      }
    });
  });
}

/**
 * Weekly comparison of installed against released versions. It only
 * checks and writes a file — a new Core version can change the rules the
 * node enforces, and that decision belongs to a person, not a timer.
 */
export class UpdateChecker {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: UpdateCheckerOptions) {}

  start(): void {
    const tick = () =>
      void this.runOnce().catch((err) => this.opts.log.warn({ err }, 'update check failed'));
    setTimeout(tick, 60_000).unref();
    this.timer = setInterval(tick, this.opts.intervalMs ?? WEEK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<StatusSnapshot['updates']> {
    const { rpc, torProxy, log } = this.opts;
    let viaTor = false;
    let agent: Agent | undefined;
    if (torProxy) {
      const u = new URL(torProxy);
      if (await portOpen(u.hostname, Number(u.port))) {
        agent = new SocksProxyAgent(torProxy);
        viaTor = true;
      }
    }

    const entries: NonNullable<StatusSnapshot['updates']>['entries'] = [];

    const net = await rpc.call('getnetworkinfo', [], networkInfoSchema);
    const coreInstalled = versionFromText(net.subversion);
    if (coreInstalled) {
      const latest = await this.latestCore(agent);
      entries.push(this.entry('Bitcoin Core', coreInstalled, latest));
    }

    const electrsInstalled = await electrumServerVersion(this.opts.electrumPort);
    if (electrsInstalled) {
      const latest = await this.latestElectrs(agent);
      entries.push(this.entry('electrs', electrsInstalled, latest));
    }

    const result = { checkedAt: Math.floor(Date.now() / 1000), viaTor, entries };
    await mkdir(dirname(this.opts.outFile), { recursive: true });
    const tmp = `${this.opts.outFile}.tmp`;
    await writeFile(tmp, JSON.stringify(result), 'utf8');
    await rename(tmp, this.opts.outFile);
    log.info({ viaTor, entries: entries.length }, 'update check written');
    return result;
  }

  private entry(name: string, installed: string, latest: string | null) {
    return {
      name,
      installed: normalize(installed),
      latest: latest ? normalize(latest) : null,
      outdated: latest !== null && isNewer(normalize(latest), normalize(installed)),
    };
  }

  private async latestCore(agent?: Agent): Promise<string | null> {
    try {
      const xml = await fetchText('https://bitcoincore.org/en/releasesrss.xml', agent);
      const titles = [...xml.matchAll(/<title>(.*?)<\/title>/gs)].map((m) => m[1]!);
      for (const t of titles.slice(1)) {
        const v = versionFromText(t);
        if (v) return v;
      }
    } catch (err) {
      this.opts.log.warn({ err }, 'could not fetch Bitcoin Core releases');
    }
    return null;
  }

  private async latestElectrs(agent?: Agent): Promise<string | null> {
    try {
      const json = await fetchText(
        'https://api.github.com/repos/romanz/electrs/releases/latest',
        agent,
      );
      return versionFromText(githubRelease.parse(JSON.parse(json)).tag_name);
    } catch (err) {
      this.opts.log.warn({ err }, 'could not fetch electrs releases');
      return null;
    }
  }
}

import { createConnection } from 'node:net';
import { request } from 'undici';
import type { StatusSnapshot } from '@btcnode/shared';
import { portOpen } from '../util/exec.js';
import { readText, unitExists } from '../util/fs.js';

type ElectrumStatus = StatusSnapshot['electrum'];

/** Answers "is this unit active?" — systemctl on the host, the agent in a container, or nobody. */
export interface UnitStatusProvider {
  isActive(unit: string): Promise<boolean | null>;
}

export interface ElectrumCollectorOptions {
  port: number;
  metricsUrl: string;
  onionFile: string;
  unit: string;
  unitDirs: string[];
}

/** Parse Prometheus text and return the electrs index height, if any. */
export function indexHeightFromMetrics(text: string): number | null {
  const exact: number[] = [];
  const rough: number[] = [];
  for (const row of text.split('\n')) {
    if (!row || row.startsWith('#')) continue;
    const m = /^([A-Za-z_:][\w:]*)(\{[^}]*\})?\s+([0-9.eE+-]+)/.exec(row);
    if (!m) continue;
    const value = Number.parseInt(String(Number(m[3])), 10);
    if (Number.isNaN(value)) continue;
    if (m[1] === 'electrs_index_height') exact.push(value);
    else if (m[1]!.includes('height')) rough.push(value);
  }
  if (exact.length) return Math.max(...exact);
  if (rough.length) return Math.max(...rough);
  return null;
}

/** Ask the Electrum port itself — the same question every wallet asks first. */
export function headersSubscribe(port: number, host = '127.0.0.1'): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    let buf = '';
    const done = (v: number | null) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(5000, () => done(null));
    sock.once('error', () => done(null));
    sock.once('connect', () => {
      sock.write('{"jsonrpc":"2.0","id":0,"method":"blockchain.headers.subscribe","params":[]}\n');
    });
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0 && buf.length < 65536) return;
      try {
        const answer = JSON.parse(buf.slice(0, nl < 0 ? undefined : nl)) as {
          result?: { height?: number };
        };
        const h = answer.result?.height;
        done(typeof h === 'number' && h > 0 ? h : null);
      } catch {
        done(null);
      }
    });
  });
}

export class ElectrumCollector {
  constructor(
    private readonly opts: ElectrumCollectorOptions,
    private readonly units: UnitStatusProvider,
    private readonly lanAddress: () => Promise<string | null>,
  ) {}

  private async indexedHeight(): Promise<number | null> {
    // Prometheus first: a plain HTTP read electrs does not log, up from the
    // first second even while indexing. The Electrum port is the fallback —
    // electrs may log every connection, and it only answers once serving.
    try {
      const res = await request(this.opts.metricsUrl, { headersTimeout: 3000, bodyTimeout: 3000 });
      const text = await res.body.text();
      const h = indexHeightFromMetrics(text.slice(0, 500_000));
      if (h !== null) return h;
    } catch {
      /* not available */
    }
    return headersSubscribe(this.opts.port);
  }

  async collect(tip: number | null): Promise<ElectrumStatus> {
    const knownByUnit = await unitExists(this.opts.unit, this.opts.unitDirs);
    const reachable = await portOpen('127.0.0.1', this.opts.port);
    const active = knownByUnit ? await this.units.isActive(this.opts.unit) : null;
    const running = active ?? reachable;
    const configured = knownByUnit || reachable;

    let indexedHeight: number | null = null;
    let indexReadable = true;
    if (configured && running) {
      indexedHeight = await this.indexedHeight();
      // An index above the node's own height is a stale or foreign answer.
      if (indexedHeight !== null && tip !== null && indexedHeight > tip) {
        indexedHeight = null;
        indexReadable = false;
      }
    }

    const ip = configured ? await this.lanAddress() : null;
    const onion = configured ? await readText(this.opts.onionFile) : null;
    return {
      configured,
      port: this.opts.port,
      running,
      reachable,
      indexedHeight,
      indexReadable,
      knownByUnit,
      lanAddress: ip ? `${ip}:${this.opts.port}` : null,
      onionAddress: onion ? `${onion}:${this.opts.port}` : null,
    };
  }
}

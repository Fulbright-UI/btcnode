import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Scenario = 'synced' | 'syncing' | 'empty';

export interface MockNodeOptions {
  user?: string;
  password?: string;
  scenario?: Scenario;
  tip?: number;
}

const TIP = 915_312;

/**
 * A real HTTP JSON-RPC server with Basic Auth, not a stubbed client: the
 * same client code runs here as against the Pi, error handling included.
 * Unknown methods answer HTTP 403 like a missing rpcwhitelist entry would.
 * Shapes are realistic on purpose — a mock that answers "0x0" to every call
 * proves only that nothing crashes.
 */
export class MockNode {
  readonly calls: { method: string; params: unknown[] }[] = [];
  scenario: Scenario;
  tip: number;
  /** When set, every call answers HTTP 500 with the warmup error */
  warmupMessage: string | null = null;
  /** When true the server does not answer at all (simulated stall) */
  stall = false;
  /** Methods that answer 403 regardless */
  readonly denied = new Set<string>();
  private server: Server | null = null;
  private readonly user: string;
  private readonly password: string;
  private stalled: ServerResponse[] = [];

  constructor(opts: MockNodeOptions = {}) {
    this.user = opts.user ?? 'dashboard';
    this.password = opts.password ?? 'secret-7f3a';
    this.scenario = opts.scenario ?? 'synced';
    this.tip = opts.tip ?? TIP;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/`;
  }

  async stop(): Promise<void> {
    for (const r of this.stalled) r.destroy();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const expected = 'Basic ' + Buffer.from(`${this.user}:${this.password}`).toString('base64');
    if (req.headers.authorization !== expected) {
      res.writeHead(401).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (this.stall) {
        this.stalled.push(res);
        return;
      }
      const { method, params, id } = JSON.parse(body) as {
        method: string;
        params: unknown[];
        id: string;
      };
      this.calls.push({ method, params });
      if (this.warmupMessage) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ result: null, error: { code: -28, message: this.warmupMessage }, id }),
        );
        return;
      }
      if (this.denied.has(method) || !(method in this.methods)) {
        res.writeHead(403).end();
        return;
      }
      const result = this.methods[method]!(params);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result, error: null, id }));
    });
  }

  private get syncing() {
    return this.scenario === 'syncing';
  }

  private readonly methods: Record<string, (params: unknown[]) => unknown> = {
    getblockchaininfo: () => ({
      chain: 'main',
      blocks: this.syncing ? 437_035 : this.tip,
      headers: this.tip,
      bestblockhash: `hash-${this.tip}`,
      difficulty: 126.3e12,
      time: this.syncing ? 1_478_175_793 : Math.floor(Date.now() / 1000) - 41,
      verificationprogress: this.syncing ? 0.112807 : 0.9999995,
      initialblockdownload: this.syncing,
      size_on_disk: 870e9,
      pruned: false,
    }),
    getnetworkinfo: () => ({
      version: 310100,
      subversion: '/Satoshi:31.1.0/',
      protocolversion: 70016,
      connections: this.scenario === 'empty' ? 0 : 23,
      connections_in: this.scenario === 'empty' ? 0 : 5,
      connections_out: this.scenario === 'empty' ? 0 : 18,
      localservicesnames: ['NETWORK', 'WITNESS', 'NETWORK_LIMITED', 'P2P_V2'],
      localaddresses: [
        {
          address: 'mockmockmockmockmockmockmockmockmockmockmockmockmockmockmock.onion',
          port: 8333,
          score: 4,
        },
        // an I2P destination: Core reports port 0, there is none
        {
          address: 'mockmockmockmockmockmockmockmockmockmockmockmockmock.b32.i2p',
          port: 0,
          score: 1,
        },
      ],
      relayfee: 0.00001,
    }),
    getmempoolinfo: () => ({
      size: this.scenario === 'empty' ? 0 : 41_233,
      usage: 198_800_000,
      maxmempool: 300_000_000,
      total_fee: 0.42,
    }),
    uptime: () => 2280,
    getpeerinfo: () => (this.scenario === 'empty' ? [] : this.peers()),
    getblockstats: (params) => {
      const height = params[0] as number;
      return {
        height,
        time: Math.floor(Date.now() / 1000) - (this.tip - height) * 600,
        total_out: 1e8 * (300 + ((height * 37) % 1400)),
        txs: 2000 + ((height * 13) % 3000),
        feerate_percentiles: [1, 2, 2 + ((height * 7) % 5), 8, 20],
      };
    },
    getnetworkhashps: (params) => {
      const height = params[1] as number;
      return 1e18 * (0.5 + (177 * height) / this.tip);
    },
    estimatesmartfee: (params) => ({
      feerate: params[1] === 'CONSERVATIVE' ? 0.000041 : 0.000028,
      blocks: 1,
    }),
  };

  private peers() {
    const now = Math.floor(Date.now() / 1000);
    const peer = (
      id: number,
      addr: string,
      network: string,
      inbound: boolean,
      minping: number,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      addr,
      network,
      inbound,
      conntime: now - 3600 - id * 100,
      pingtime: minping * 3 + 0.01,
      minping,
      subver: '/Satoshi:28.0.0/',
      servicesnames: ['NETWORK', 'WITNESS'],
      bytessent: 44_000 + id * 1000,
      bytesrecv: 120_000 + id * 500,
      addr_processed: id === 0 ? 0 : 1000 + id * 137,
      addr_rate_limited: id % 5 === 0 ? 0 : id * 3,
      last_block: 0,
      bytessent_per_msg: { cmpctblock: 1000, block: 0, blocktxn: 0, headers: 500 },
      ...extra,
    });
    return [
      // our own electrs, arriving from localhost like an onion connection
      peer(0, '127.0.0.1:51102', 'not_publicly_routable', true, 0.0008, {
        subver: '/electrs:0.11.1/',
      }),
      // an inbound onion connection: Core sees only 127.0.0.1
      peer(1, '127.0.0.1:35824', 'not_publicly_routable', true, 0.547),
      // a second node on the home network: genuinely local
      peer(2, '192.168.1.77:8333', 'not_publicly_routable', false, 0.002),
      // a hostile user agent — must never become markup anywhere
      peer(
        3,
        'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghzw.onion:8333',
        'onion',
        false,
        0.293,
        {
          subver: '/<b>Knoten</b>:1.0/',
          last_block: now - 41,
        },
      ),
      peer(4, '203.0.113.9:8333', 'ipv4', false, 0.02),
      peer(5, '[2001:db8::9]:8333', 'ipv6', false, 0.033),
      peer(
        6,
        'q2lprcumxqcbxqrhm4evj3x4zwrpxp4c5z7wmmkgkt7wp7ncjdkr7iyd.b32.i2p:0',
        'i2p',
        false,
        1.2,
      ),
      ...Array.from({ length: 16 }, (_, i) =>
        peer(
          10 + i,
          `198.51.100.${i}:8333`,
          i % 2 ? 'ipv4' : 'onion',
          i % 3 === 0,
          0.05 + i * 0.02,
        ),
      ),
    ];
  }
}

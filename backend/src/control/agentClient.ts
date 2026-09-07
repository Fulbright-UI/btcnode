import { createConnection } from 'node:net';
import { CONTROL_ACTIONS } from '@btcnode/shared';
import type { ControlAction } from '@btcnode/shared';
import { z } from 'zod';

const replySchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  /** 'missing': neither a unit nor a container of that name exists on the host */
  units: z
    .record(z.string(), z.enum(['active', 'inactive', 'failed', 'missing', 'unknown']))
    .optional(),
  /** What the agent offers here; an old agent without the field offers everything */
  available: z.array(z.string()).optional(),
});
export type AgentReply = z.infer<typeof replySchema>;

/**
 * Talks to the host agent over its Unix socket: one JSON line in, one out.
 * The agent knows exactly the actions in CONTROL_ACTIONS plus `status`;
 * anything else it refuses, and the socket is the only privilege this
 * process has on the host.
 */
export class AgentClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private send(payload: Record<string, unknown>): Promise<AgentReply> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(this.socketPath);
      let buf = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        fn();
      };
      sock.setTimeout(this.timeoutMs, () => finish(() => reject(new Error('agent timed out'))));
      sock.once('error', (err) => finish(() => reject(err)));
      sock.once('connect', () => sock.write(JSON.stringify(payload) + '\n'));
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const nl = buf.indexOf('\n');
        if (nl < 0) return;
        try {
          const parsed = replySchema.parse(JSON.parse(buf.slice(0, nl)));
          finish(() => resolve(parsed));
        } catch (err) {
          finish(() => reject(err));
        }
      });
      sock.once('close', () => finish(() => reject(new Error('agent closed the connection'))));
    });
  }

  status(): Promise<AgentReply> {
    return this.send({ action: 'status' });
  }

  run(action: ControlAction): Promise<AgentReply> {
    return this.send({ action });
  }
}

/** Unit state and the offered actions through the agent, cached briefly. */
export class AgentUnitStatus {
  private cache: { at: number; units: Record<string, string>; available: string[] | null } | null =
    null;

  constructor(
    private readonly agent: AgentClient,
    private readonly ttlMs = 10_000,
  ) {}

  private async refresh(): Promise<boolean> {
    const now = Date.now();
    if (this.cache && now - this.cache.at <= this.ttlMs) return true;
    try {
      const r = await this.agent.status();
      this.cache = { at: now, units: r.units ?? {}, available: r.available ?? null };
      return true;
    } catch {
      return false;
    }
  }

  async isActive(unit: string): Promise<boolean | null> {
    if (!(await this.refresh())) return null;
    const state = this.cache!.units[unit];
    if (state === undefined || state === 'unknown') return null;
    return state === 'active';
  }

  /** Actions the host can perform. Unreachable agent or old agent: all of them — hiding on a hiccup would look like a bug. */
  async actions(): Promise<ControlAction[]> {
    if (!(await this.refresh()) || !this.cache!.available) return [...CONTROL_ACTIONS];
    const offered = new Set(this.cache!.available);
    return CONTROL_ACTIONS.filter((a) => offered.has(a));
  }
}

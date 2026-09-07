import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import session from '@fastify/session';
import type { Chronicle, StatusSnapshot } from '@btcnode/shared';
import { controlRequestSchema, loginRequestSchema } from '@btcnode/shared';
import Fastify, { LogController } from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyPassword } from './auth/password.js';
import type { AgentClient } from './control/agentClient.js';

/** What the routes need — the poller in production, a stub in tests. */
export interface StatusSource {
  readonly status: StatusSnapshot | null;
  readonly log: string;
  readonly chronicle: Chronicle;
}

export interface AppOptions {
  source: StatusSource;
  agent: AgentClient | null;
  adminPasswordHash: string | null;
  sessionKey: Buffer | null;
  secureCookie: boolean;
  logLevel?: string;
  trustProxy?: boolean;
}

declare module 'fastify' {
  interface Session {
    admin?: boolean;
    issuedAt?: number;
  }
}

const SESSION_MAX_AGE = 12 * 3600;
/** A custom header that a cross-site form or fetch cannot send without CORS — the CSRF guard next to SameSite=Strict. */
const CSRF_HEADER = 'x-requested-with';

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    trustProxy: opts.trustProxy ?? false,
    // The page polls every few seconds; one line per poll would drown the journal.
    logController: new LogController({ disableRequestLogging: true }),
  });
  const controlEnabled =
    opts.agent !== null && opts.adminPasswordHash !== null && opts.sessionKey !== null;

  await app.register(rateLimit, { global: false });
  await app.register(cookie);
  if (opts.sessionKey) {
    // Server-side sessions (in memory): a logout really ends the session,
    // which a stateless encrypted cookie could not guarantee. A restart of
    // the backend logs everyone out — acceptable for one admin.
    await app.register(session, {
      secret: opts.sessionKey.toString('hex'),
      cookieName: 'btcnode.session',
      cookie: {
        path: '/',
        httpOnly: true,
        secure: opts.secureCookie,
        sameSite: 'strict',
        maxAge: SESSION_MAX_AGE * 1000,
      },
      saveUninitialized: false,
    });
  }

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  // ---- read side -----------------------------------------------------------
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/status', async (_req, reply) => {
    const s = opts.source.status;
    if (!s) return reply.code(503).send({ error: 'no status yet' });
    return s;
  });

  app.get('/api/log', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8');
    return opts.source.log;
  });

  app.get('/api/chronicle', async () => opts.source.chronicle);

  // ---- control side --------------------------------------------------------
  const isAdmin = (req: FastifyRequest): boolean => {
    if (!opts.sessionKey) return false;
    const s = req.session;
    const issued = s.issuedAt;
    return (
      s.admin === true && typeof issued === 'number' && Date.now() / 1000 - issued < SESSION_MAX_AGE
    );
  };

  const requireCsrfHeader = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers[CSRF_HEADER] !== 'btcnode') {
      return reply.code(403).send({ error: 'missing request header' });
    }
  };

  app.get('/api/auth/session', async (req) => ({
    authenticated: isAdmin(req),
    controlAvailable: controlEnabled,
  }));

  app.post(
    '/api/auth/login',
    {
      preHandler: requireCsrfHeader,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!controlEnabled) return reply.code(404).send({ error: 'control not configured' });
      const body = loginRequestSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'password required' });
      const ok = await verifyPassword(body.data.password, opts.adminPasswordHash);
      if (!ok) {
        req.log.warn({ ip: req.ip }, 'failed login');
        return reply.code(401).send({ error: 'wrong password' });
      }
      await req.session.regenerate();
      req.session.admin = true;
      req.session.issuedAt = Math.floor(Date.now() / 1000);
      req.log.info({ ip: req.ip }, 'admin logged in');
      return { authenticated: true, controlAvailable: true };
    },
  );

  app.post('/api/auth/logout', { preHandler: requireCsrfHeader }, async (req) => {
    if (opts.sessionKey) await req.session.destroy();
    return { authenticated: false, controlAvailable: controlEnabled };
  });

  app.post(
    '/api/control',
    { preHandler: requireCsrfHeader, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!controlEnabled || !opts.agent)
        return reply.code(404).send({ error: 'control not configured' });
      if (!isAdmin(req)) return reply.code(401).send({ error: 'login required' });
      const body = controlRequestSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'unknown action' });
      const action = body.data.action;
      req.log.warn({ ip: req.ip, action }, 'control action requested');
      try {
        const r = await opts.agent.run(action);
        return { ok: r.ok, action, ...(r.message ? { message: r.message } : {}) };
      } catch (err) {
        req.log.error({ err, action }, 'agent call failed');
        return reply.code(502).send({ ok: false, action, message: 'agent not reachable' });
      }
    },
  );

  return app;
}

import { randomBytes } from 'node:crypto';
import type { Chronicle, StatusSnapshot } from '@btcnode/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { StatusSource } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { AgentClient, AgentUnitStatus } from '../src/control/agentClient.js';
import { createEnv } from './helpers/env.js';
import type { TestEnv } from './helpers/env.js';
import { fakeAgent } from './helpers/fakeAgent.js';

let env: TestEnv;
let agent: Awaited<ReturnType<typeof fakeAgent>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const password = 'correct horse battery';

beforeAll(async () => {
  env = await createEnv();
  await env.poller.runStatus();
  await env.poller.runLog();
  agent = await fakeAgent({ electrs: 'missing' }); // a host without an Electrum server
  app = await buildApp({
    source: env.poller,
    agent: new AgentClient(agent.path),
    agentActions: () => new AgentUnitStatus(new AgentClient(agent.path)).actions(),
    adminPasswordHash: await hashPassword(password),
    sessionKey: randomBytes(32),
    secureCookie: false,
    logLevel: 'silent',
  });
});

afterAll(async () => {
  await app.close();
  await agent.stop();
  await env.stop();
});

const csrf = { 'x-requested-with': 'btcnode', 'content-type': 'application/json' };

describe('read side', () => {
  it('serves the status snapshot as JSON with no-store', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/status' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const s = r.json<StatusSnapshot>();
    expect(s.hostname).toBe('testnode');
    expect(s.node?.blocks).toBe(env.node.tip);
  });

  it('serves the log as plain text', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/log' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/plain/);
    expect(r.body).toContain('UpdateTip');
  });

  it('serves the chronicle', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/chronicle' });
    expect(r.json<Chronicle>().entries.length).toBe(2);
  });

  it('answers 503 before the first pass', async () => {
    const empty: StatusSource = { status: null, log: '', chronicle: env.poller.chronicle };
    const a = await buildApp({
      source: empty,
      agent: null,
      adminPasswordHash: null,
      sessionKey: null,
      secureCookie: false,
      logLevel: 'silent',
    });
    const r = await a.inject({ method: 'GET', url: '/api/status' });
    expect(r.statusCode).toBe(503);
    const s = await a.inject({ method: 'GET', url: '/api/auth/session' });
    expect(s.json()).toEqual({ authenticated: false, controlAvailable: false });
    await a.close();
  });
});

describe('control', () => {
  it('refuses control without a session and without the request header', async () => {
    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/control',
      payload: { action: 'restart-bitcoind' },
    });
    expect(noHeader.statusCode).toBe(403);
    const noSession = await app.inject({
      method: 'POST',
      url: '/api/control',
      headers: csrf,
      payload: { action: 'restart-bitcoind' },
    });
    expect(noSession.statusCode).toBe(401);
    expect(agent.asked).not.toContain('restart-bitcoind');
  });

  it('logs in, runs an allowed action, refuses unknown ones, logs out', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: csrf,
      payload: { password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: csrf,
      payload: { password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === 'btcnode.session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    const jar = { 'btcnode.session': cookie!.value };

    const session = await app.inject({ method: 'GET', url: '/api/auth/session', cookies: jar });
    // in the contract's fixed order, without what the host lacks (electrs)
    expect(session.json()).toEqual({
      authenticated: true,
      controlAvailable: true,
      actions: ['restart-bitcoind', 'reboot', 'poweroff'],
    });

    const ok = await app.inject({
      method: 'POST',
      url: '/api/control',
      headers: csrf,
      cookies: jar,
      payload: { action: 'restart-bitcoind' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      ok: true,
      action: 'restart-bitcoind',
      message: 'restart-bitcoind done',
    });
    expect(agent.asked).toContain('restart-bitcoind');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/control',
      headers: csrf,
      cookies: jar,
      payload: { action: 'rm -rf /' },
    });
    expect(bad.statusCode).toBe(400);

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'x-requested-with': 'btcnode' },
      cookies: jar,
    });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({
      method: 'POST',
      url: '/api/control',
      headers: csrf,
      cookies: jar,
      payload: { action: 'reboot' },
    });
    expect(after.statusCode).toBe(401);
  });

  it('rate-limits login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: csrf,
        payload: { password: 'x' },
        remoteAddress: '10.9.9.9',
      });
      last = r.statusCode;
    }
    expect(last).toBe(429);
  });
});

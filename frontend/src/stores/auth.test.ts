import { CONTROL_ACTIONS } from '@btcnode/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './auth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const status = (code: number) => new Response('', { status: code });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('auth store: session', () => {
  it('starts logged out, offering every action, not yet loaded', () => {
    const auth = useAuthStore();
    expect(auth.authenticated).toBe(false);
    expect(auth.controlAvailable).toBe(false);
    expect(auth.actions).toEqual([...CONTROL_ACTIONS]);
    expect(auth.loaded).toBe(false);
  });

  it('takes the session and the actions the agent offers', async () => {
    fetchMock.mockResolvedValue(
      json({ authenticated: true, controlAvailable: true, actions: ['reboot', 'poweroff'] }),
    );
    const auth = useAuthStore();
    await auth.load();
    expect(auth.authenticated).toBe(true);
    expect(auth.controlAvailable).toBe(true);
    expect(auth.actions).toEqual(['reboot', 'poweroff']);
    expect(auth.loaded).toBe(true);
  });

  it('keeps all actions when the session names none', async () => {
    fetchMock.mockResolvedValue(json({ authenticated: false, controlAvailable: true }));
    const auth = useAuthStore();
    await auth.load();
    expect(auth.controlAvailable).toBe(true);
    expect(auth.actions).toEqual([...CONTROL_ACTIONS]);
  });

  it('falls back to logged out without control when the session cannot be read', async () => {
    const auth = useAuthStore();
    auth.authenticated = true;
    auth.controlAvailable = true;
    fetchMock.mockResolvedValue(status(500));
    await auth.load();
    expect(auth.authenticated).toBe(false);
    expect(auth.controlAvailable).toBe(false);
    expect(auth.loaded).toBe(true);
  });
});

describe('auth store: login and logout', () => {
  it('returns null and takes the actions on success', async () => {
    fetchMock.mockResolvedValue(
      json({ authenticated: true, controlAvailable: true, actions: ['restart-bitcoind'] }),
    );
    const auth = useAuthStore();
    await expect(auth.login('pw')).resolves.toBeNull();
    expect(auth.authenticated).toBe(true);
    expect(auth.actions).toEqual(['restart-bitcoind']);
  });

  it('keeps the actions when a successful login names none', async () => {
    fetchMock.mockResolvedValue(json({ authenticated: true, controlAvailable: true }));
    const auth = useAuthStore();
    await expect(auth.login('pw')).resolves.toBeNull();
    expect(auth.actions).toEqual([...CONTROL_ACTIONS]);
  });

  it.each([
    [401, 'wrong'],
    [429, 'tooMany'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %i to %s', async (code, result) => {
    fetchMock.mockResolvedValue(status(code));
    const auth = useAuthStore();
    await expect(auth.login('pw')).resolves.toBe(result);
    expect(auth.authenticated).toBe(false);
  });

  it('reports a network failure as unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(useAuthStore().login('pw')).resolves.toBe('unavailable');
  });

  it('logs out locally after the server confirms', async () => {
    fetchMock.mockResolvedValue(json({ authenticated: false, controlAvailable: true }));
    const auth = useAuthStore();
    auth.authenticated = true;
    await auth.logout();
    expect(auth.authenticated).toBe(false);
  });

  it('logs out locally even when the server request fails', async () => {
    fetchMock.mockResolvedValue(status(500));
    const auth = useAuthStore();
    auth.authenticated = true;
    await expect(auth.logout()).rejects.toMatchObject({ status: 500 });
    expect(auth.authenticated).toBe(false);
  });
});

describe('auth store: control actions', () => {
  it('passes the result of a control action through', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, action: 'restart-electrs', message: 'done' }));
    await expect(useAuthStore().run('restart-electrs')).resolves.toEqual({
      ok: true,
      action: 'restart-electrs',
      message: 'done',
    });
  });

  it('drops the login when the server answers 401', async () => {
    fetchMock.mockResolvedValue(status(401));
    const auth = useAuthStore();
    auth.authenticated = true;
    await expect(auth.run('reboot')).resolves.toEqual({
      ok: false,
      action: 'reboot',
      message: '/api/control: HTTP 401',
    });
    expect(auth.authenticated).toBe(false);
  });

  it('keeps the login on other errors', async () => {
    fetchMock.mockResolvedValue(status(502));
    const auth = useAuthStore();
    auth.authenticated = true;
    const r = await auth.run('poweroff');
    expect(r).toMatchObject({ ok: false, action: 'poweroff' });
    expect(auth.authenticated).toBe(true);
  });

  it('says "failed" when the error is not an Error', async () => {
    fetchMock.mockRejectedValue('offline');
    await expect(useAuthStore().run('reboot')).resolves.toEqual({
      ok: false,
      action: 'reboot',
      message: 'failed',
    });
  });
});

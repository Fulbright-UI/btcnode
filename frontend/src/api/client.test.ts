import { ZodError } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '@/test/snapshot';
import { ApiError, api } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();
const lastCall = () => {
  const [path, init] = fetchMock.mock.lastCall!;
  return { path, init: init!, headers: (init!.headers ?? {}) as Record<string, string> };
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('GET endpoints', () => {
  it('fetches the status without cache and with same-origin cookies', async () => {
    const s = snapshot();
    fetchMock.mockResolvedValue(json(s));
    await expect(api.status()).resolves.toEqual(s);
    const { path, init } = lastCall();
    expect(path).toBe('/api/status');
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(init.method).toBeUndefined();
  });

  it('reads chronicle and session from their paths', async () => {
    const chronicle = {
      start: 100,
      interval: 21,
      entries: [{ date: '2009', who: 'x', text: 'y' }],
    };
    fetchMock.mockResolvedValueOnce(json(chronicle));
    await expect(api.chronicle()).resolves.toEqual(chronicle);
    expect(lastCall().path).toBe('/api/chronicle');

    fetchMock.mockResolvedValueOnce(json({ authenticated: false, controlAvailable: true }));
    await expect(api.session()).resolves.toEqual({ authenticated: false, controlAvailable: true });
    expect(lastCall().path).toBe('/api/auth/session');
  });

  it('returns the log as plain text', async () => {
    fetchMock.mockResolvedValue(new Response('line 1\nline 2'));
    await expect(api.log()).resolves.toBe('line 1\nline 2');
    expect(lastCall().path).toBe('/api/log');
    expect(lastCall().init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
  });

  it('turns an HTTP error into an ApiError carrying the status', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    const err = await api.status().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ name: 'ApiError', status: 503, message: '/api/status: HTTP 503' });
  });

  it('turns a failed log request into an ApiError as well', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    await expect(api.log()).rejects.toMatchObject({ status: 401, message: '/api/log: HTTP 401' });
  });

  it('rejects a body that does not match the schema', async () => {
    fetchMock.mockResolvedValue(json({ ...snapshot(), hostname: 42 }));
    await expect(api.status()).rejects.toBeInstanceOf(ZodError);
    fetchMock.mockResolvedValue(json({ start: 1, interval: 21, entries: [] }));
    await expect(api.chronicle()).rejects.toBeInstanceOf(ZodError);
  });

  it('rejects a body that is not JSON at all', async () => {
    fetchMock.mockResolvedValue(new Response('<html>proxy error</html>'));
    await expect(api.session()).rejects.toBeInstanceOf(SyntaxError);
  });

  it('passes network failures through unchanged', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.status()).rejects.toThrow('Failed to fetch');
  });
});

describe('POST endpoints', () => {
  it('sends the password as JSON with the CSRF header', async () => {
    fetchMock.mockResolvedValue(json({ authenticated: true, controlAvailable: true }));
    await expect(api.login('secret')).resolves.toMatchObject({ authenticated: true });
    const { path, init, headers } = lastCall();
    expect(path).toBe('/api/auth/login');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    expect(headers).toEqual({
      'x-requested-with': 'btcnode',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({ password: 'secret' });
  });

  it('sends logout without a body and therefore without a content type', async () => {
    fetchMock.mockResolvedValue(json({ authenticated: false, controlAvailable: true }));
    await api.logout();
    const { path, init, headers } = lastCall();
    expect(path).toBe('/api/auth/logout');
    expect(init.method).toBe('POST');
    expect(headers).toEqual({ 'x-requested-with': 'btcnode' });
    expect('body' in init).toBe(false);
  });

  it('posts a control action and validates the result', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, action: 'reboot' }));
    await expect(api.control('reboot')).resolves.toEqual({ ok: true, action: 'reboot' });
    expect(lastCall().path).toBe('/api/control');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ action: 'reboot' });
    expect(lastCall().headers['x-requested-with']).toBe('btcnode');

    fetchMock.mockResolvedValue(json({ ok: true, action: 'format-disk' }));
    await expect(api.control('reboot')).rejects.toBeInstanceOf(ZodError);
  });

  it('maps a rejected POST to an ApiError', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    await expect(api.login('x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      message: '/api/auth/login: HTTP 429',
    });
  });
});

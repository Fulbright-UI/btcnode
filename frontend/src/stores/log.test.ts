import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogStore } from './log';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  useLogStore().stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('log store', () => {
  it('replaces the text with the latest log', async () => {
    fetchMock.mockResolvedValue(new Response('a\nb'));
    const log = useLogStore();
    await log.refresh();
    expect(log.text).toBe('a\nb');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/log');
  });

  it('keeps the last text when a fetch fails', async () => {
    const log = useLogStore();
    fetchMock.mockResolvedValueOnce(new Response('kept'));
    await log.refresh();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }));
    await log.refresh();
    expect(log.text).toBe('kept');
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await log.refresh();
    expect(log.text).toBe('kept');
  });

  it('fetches at once and then every three seconds by default', async () => {
    fetchMock.mockImplementation(async () => new Response(`call ${fetchMock.mock.calls.length}`));
    const log = useLogStore();
    log.start();
    expect(log.interval).toBe(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.text).toBe('call 1');
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(log.text).toBe('call 4');
  });

  it('uses the interval it is started with', async () => {
    fetchMock.mockImplementation(async () => new Response('x'));
    const log = useLogStore();
    log.start(10);
    expect(log.interval).toBe(10);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('runs one timer only when started twice, and none after stop', async () => {
    fetchMock.mockImplementation(async () => new Response('x'));
    const log = useLogStore();
    log.start(5);
    log.start(5);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    log.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    log.stop();
  });
});

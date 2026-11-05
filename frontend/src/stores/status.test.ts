import type { StatusSnapshot } from '@btcnode/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, snapshot } from '@/test/snapshot';
import { useStatusStore } from './status';

const ok = (s: StatusSnapshot = snapshot()) => new Response(JSON.stringify(s));
const status = (code: number) => new Response('', { status: code });
/** Snapshot telling the page to poll every `seconds`. */
const every = (seconds: number) => snapshot({ intervals: { status: seconds, log: 3 } });

const fetchMock = vi.fn<typeof fetch>();
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  useStatusStore().stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('status store: refresh', () => {
  it('has nothing before the first fetch', () => {
    const s = useStatusStore();
    expect(s.snapshot).toBeNull();
    expect(s.freshness).toBe('none');
    expect(s.interval).toBe(21);
    expect(s.fetchedAt).toBeNull();
  });

  it('stores the snapshot and the time it arrived', async () => {
    fetchMock.mockResolvedValue(ok(every(7)));
    const s = useStatusStore();
    await s.refresh();
    expect(s.snapshot?.hostname).toBe('testnode');
    expect(s.fetchedAt).toBe(NOW);
    expect(s.freshness).toBe('fresh');
    expect(s.interval).toBe(7);
    expect(s.failed).toBe(false);
    expect(s.backendDown).toBe(false);
  });

  it('keeps the old snapshot on failure and marks it stale', async () => {
    const s = useStatusStore();
    fetchMock.mockResolvedValueOnce(ok());
    await s.refresh();
    fetchMock.mockResolvedValueOnce(status(500));
    await s.refresh();
    expect(s.snapshot?.hostname).toBe('testnode');
    expect(s.fetchedAt).toBe(NOW);
    expect(s.failed).toBe(true);
    expect(s.freshness).toBe('stale');
    expect(s.backendDown).toBe(true);
  });

  it('does not call a 503 "down": the backend is still on its first pass', async () => {
    fetchMock.mockResolvedValue(status(503));
    const s = useStatusStore();
    await s.refresh();
    expect(s.failed).toBe(true);
    expect(s.backendDown).toBe(false);
    expect(s.freshness).toBe('none');
  });

  it('calls a network failure or a broken body "down"', async () => {
    const s = useStatusStore();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await s.refresh();
    expect(s.backendDown).toBe(true);

    fetchMock.mockResolvedValueOnce(ok());
    await s.refresh();
    expect(s.backendDown).toBe(false);

    fetchMock.mockResolvedValueOnce(new Response('{"hostname":1}'));
    await s.refresh();
    expect(s.backendDown).toBe(true);
    expect(s.freshness).toBe('stale');
  });

  it('recovers to fresh after a failure', async () => {
    const s = useStatusStore();
    fetchMock.mockResolvedValueOnce(status(502));
    await s.refresh();
    fetchMock.mockResolvedValueOnce(ok());
    vi.setSystemTime((NOW + 30) * 1000);
    await s.refresh();
    expect(s.failed).toBe(false);
    expect(s.freshness).toBe('fresh');
    expect(s.fetchedAt).toBe(NOW + 30);
  });
});

describe('status store: polling', () => {
  it('fetches at once and then at the interval the snapshot names', async () => {
    fetchMock.mockImplementation(async () => ok(every(5)));
    const s = useStatusStore();
    s.start();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('follows a change of the interval from one snapshot to the next', async () => {
    fetchMock.mockResolvedValueOnce(ok(every(5))).mockImplementation(async () => ok(every(30)));
    const s = useStatusStore();
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps polling at the default interval while the backend is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const s = useStatusStore();
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(21_000 * 3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(s.backendDown).toBe(true);
  });

  it('stops polling on stop', async () => {
    fetchMock.mockImplementation(async () => ok(every(5)));
    const s = useStatusStore();
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('schedules nothing when stopped while the first fetch is still running', async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (answer = r)));
    const s = useStatusStore();
    s.start();
    s.stop();
    answer(ok(every(5)));
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reschedule when stopped during a scheduled fetch', async () => {
    fetchMock.mockImplementationOnce(async () => ok(every(5)));
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (answer = r)));
    const s = useStatusStore();
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    s.stop();
    answer(ok(every(5)));
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs a single chain after a restart, even if the old first fetch answers late', async () => {
    let answerOld!: (r: Response) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((r) => (answerOld = r)))
      .mockImplementation(async () => ok(every(5)));
    const s = useStatusStore();
    s.start();
    s.start();
    await flush();
    answerOld(ok(every(5)));
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

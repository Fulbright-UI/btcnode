import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

const T0 = 1_790_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0 * 1000);
});
afterEach(() => vi.useRealTimers());

describe('useNow', () => {
  it('ticks once a second in unix seconds', () => {
    const scope = effectScope();
    const now = scope.run(() => useNow())!;
    vi.advanceTimersByTime(1000);
    expect(now.value).toBe(T0 + 1);
    vi.advanceTimersByTime(4000);
    expect(now.value).toBe(T0 + 5);
    scope.stop();
  });

  it('shares one clock and one timer between subscribers', () => {
    const a = effectScope();
    const b = effectScope();
    const nowA = a.run(() => useNow())!;
    const nowB = b.run(() => useNow())!;
    expect(nowA).toBe(nowB);
    expect(vi.getTimerCount()).toBe(1);

    a.stop();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(nowB.value).toBe(T0 + 2);

    b.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when the last subscriber leaves and starts again for a new one', () => {
    const first = effectScope();
    const now = first.run(() => useNow())!;
    vi.advanceTimersByTime(1000);
    first.stop();
    const frozen = now.value;
    vi.advanceTimersByTime(10_000);
    expect(now.value).toBe(frozen);

    const second = effectScope();
    second.run(() => useNow());
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(now.value).toBe(frozen + 11);
    second.stop();
  });
});

import type { Chronicle } from '@btcnode/shared';
import fc from 'fast-check';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChronicleStore } from './chronicle';

const chronicle: Chronicle = {
  start: 1000,
  interval: 10,
  entries: [
    { date: '2008-10-31', who: 'Satoshi', text: 'Whitepaper' },
    { date: '2009-01-03', who: 'Satoshi', text: 'Genesis' },
    { date: '2010-05-22', who: 'Laszlo', text: 'Pizza' },
  ],
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('chronicle store', () => {
  it('has no entry and the default interval before loading', () => {
    const c = useChronicleStore();
    expect(c.data).toBeNull();
    expect(c.interval).toBe(21);
    expect(c.entryAt(5000)).toBeNull();
  });

  it('loads the chronicle and takes its interval', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(chronicle)));
    const c = useChronicleStore();
    await c.load();
    expect(c.data).toEqual(chronicle);
    expect(c.interval).toBe(10);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/chronicle');
  });

  it('forgets the chronicle when loading fails', async () => {
    const c = useChronicleStore();
    c.data = chronicle;
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    await c.load();
    expect(c.data).toBeNull();
    expect(c.interval).toBe(21);
  });

  it('advances one entry per interval on the backend clock and wraps around', () => {
    const c = useChronicleStore();
    c.data = chronicle;
    expect(c.entryAt(1000)).toEqual({ index: 0, entry: chronicle.entries[0] });
    expect(c.entryAt(1009.9)!.index).toBe(0);
    expect(c.entryAt(1010)).toEqual({ index: 1, entry: chronicle.entries[1] });
    expect(c.entryAt(1025)!.entry.text).toBe('Pizza');
    expect(c.entryAt(1030)).toEqual({ index: 3, entry: chronicle.entries[0] });
  });

  it('stays on the first entry for a clock before the start', () => {
    const c = useChronicleStore();
    c.data = chronicle;
    expect(c.entryAt(0)).toEqual({ index: 0, entry: chronicle.entries[0] });
  });

  it('returns null for an empty list', () => {
    const c = useChronicleStore();
    c.data = { ...chronicle, entries: [] };
    expect(c.entryAt(2000)).toBeNull();
  });

  it('never goes back in time and always picks an existing entry', () => {
    const c = useChronicleStore();
    c.data = chronicle;
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e10, noNaN: true }),
        fc.double({ min: -1e9, max: 1e10, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const x = c.entryAt(lo)!;
          const y = c.entryAt(hi)!;
          expect(x.index).toBeLessThanOrEqual(y.index);
          expect(chronicle.entries).toContainEqual(y.entry);
        },
      ),
    );
  });
});

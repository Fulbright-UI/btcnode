import { enableAutoUnmount, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ChronicleTerminal from '@/components/layout/ChronicleTerminal.vue';
import { useChronicleStore } from '@/stores/chronicle';
import { useStatusStore } from '@/stores/status';
import { NOW } from '@/test/snapshot';
import { setup } from '@/test/mount';

enableAutoUnmount(afterEach);

const chronicle = {
  start: NOW,
  interval: 21,
  entries: [
    { date: '2009-01-03', who: 'Satoshi', text: 'Genesis.' },
    { date: '2010-05', who: 'Laszlo', text: 'Pizza, 10k BTC.' },
  ],
};

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

function line(w: VueWrapper): string {
  return w.find('.typed').text().replace(/\s+/g, ' ').trim();
}

function render(locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  const w = mount(ChronicleTerminal, { global });
  return { w, store: useChronicleStore(), status: useStatusStore() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime((NOW + 5) * 1000);
  setHidden(false);
});
afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe('ChronicleTerminal', () => {
  it('is an empty line with the cursor at the end before data arrives', () => {
    const { w } = render();
    expect(line(w)).toBe('');
    expect(w.findAll('.cursor')).toHaveLength(1);
    expect(w.find('.part-text + .cursor').exists()).toBe(true);
    expect(w.classes()).not.toContain('typing');
  });

  it('lands on the current entry fully typed on first load', async () => {
    const { w, store } = render();
    store.data = chronicle;
    await nextTick();
    expect(w.find('.part-date').text()).toBe('[2009-01-03]');
    expect(w.find('.part-who').text()).toBe('Satoshi');
    expect(w.find('.part-text').text()).toBe('Genesis.');
    expect(w.classes()).not.toContain('typing');
  });

  it('writes the date the German way', async () => {
    const { w, store } = render('de');
    store.data = chronicle;
    await nextTick();
    expect(w.find('.part-date').text()).toBe('[03.01.2009]');
  });

  it('deletes the old entry and types the next one on a later data cycle', async () => {
    const { w, store, status } = render();
    store.data = chronicle;
    await nextTick();

    vi.setSystemTime((NOW + 22) * 1000);
    status.fetchedAt = NOW + 22;
    await nextTick();
    // first step removes the last character of the old line
    expect(line(w)).toBe('[2009-01-03] Satoshi Genesis');
    expect(w.classes()).toContain('typing');

    const cursors = new Set<string>();
    for (let i = 0; i < 200 && line(w) !== '[2010-05] Laszlo Pizza, 10k BTC.'; i++) {
      vi.advanceTimersToNextTimer();
      await nextTick();
      const c = w.find('.cursor').element.previousElementSibling?.className;
      if (c) cursors.add(c);
    }
    expect(line(w)).toBe('[2010-05] Laszlo Pizza, 10k BTC.');
    // the cursor travelled through all three fields
    expect(cursors).toEqual(new Set(['part-date', 'part-who', 'part-text']));
    vi.runOnlyPendingTimers();
    await nextTick();
    expect(w.classes()).not.toContain('typing');
  });

  it('ignores a data cycle within the same entry window', async () => {
    const { w, store, status } = render();
    store.data = chronicle;
    await nextTick();
    status.fetchedAt = NOW + 10;
    await nextTick();
    expect(line(w)).toBe('[2009-01-03] Satoshi Genesis.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores data cycles before the chronicle has loaded', async () => {
    const { w, status } = render();
    status.fetchedAt = NOW + 22;
    await nextTick();
    expect(line(w)).toBe('');
  });

  it('jumps straight to the target in a hidden tab and resumes when visible', async () => {
    const { w, store, status } = render();
    store.data = chronicle;
    await nextTick();
    setHidden(true);
    vi.setSystemTime((NOW + 22) * 1000);
    status.fetchedAt = NOW + 22;
    await nextTick();
    expect(line(w)).toBe('[2010-05] Laszlo Pizza, 10k BTC.');
    expect(vi.getTimerCount()).toBe(0);

    // a visibility change while still hidden does nothing; visible again is settled
    document.dispatchEvent(new Event('visibilitychange'));
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(line(w)).toBe('[2010-05] Laszlo Pizza, 10k BTC.');
    expect(w.classes()).not.toContain('typing');
  });
});

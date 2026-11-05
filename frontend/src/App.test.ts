import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import FeeCard from '@/components/cards/FeeCard.vue';
import VolumeCard from '@/components/cards/VolumeCard.vue';
import { i18n } from '@/i18n';
import { useLogStore } from '@/stores/log';
import { useStatusStore } from '@/stores/status';
import { json, setup, stubFetch } from '@/test/mount';
import { NOW, snapshot } from '@/test/snapshot';

// the template's /bitcoin.png lives in public/, which vitest cannot import
vi.mock('/bitcoin.png', () => ({ default: '/bitcoin.png' }));

enableAutoUnmount(afterEach);

const chronicle = {
  start: NOW,
  interval: 21,
  entries: [{ date: '2009-01-03', who: 'Satoshi', text: 'Genesis.' }],
};

/** Answers every API path; the status answer can be swapped between polls. */
function backend(initial: StatusSnapshot | null) {
  let status: StatusSnapshot | null = initial;
  const fetch = stubFetch((url) => {
    switch (url) {
      case '/api/status':
        return status ? json(status) : json({}, 500);
      case '/api/log':
        return new Response('2026-11-05 UpdateTip: height=915312', { status: 200 });
      case '/api/chronicle':
        return json(chronicle);
      case '/api/auth/session':
        return json({ authenticated: false, controlAvailable: false });
      default:
        return json({}, 404);
    }
  });
  return {
    fetch,
    set: (s: StatusSnapshot | null) => (status = s),
  };
}

async function render(initial: StatusSnapshot | null, locale: 'en' | 'de' = 'en') {
  const api = backend(initial);
  const { global } = setup(locale);
  const w = mount(App, { global, attachTo: document.body });
  await flushPromises();
  return { w, api };
}

const root = document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime((NOW + 5) * 1000);
  document.title = 'btcnode';
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  i18n.global.locale.value = 'en';
});

describe('App', () => {
  it('loads every source on mount and renders the dashboard', async () => {
    const { w, api } = await render(snapshot());
    const paths = api.fetch.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining(['/api/status', '/api/log', '/api/chronicle', '/api/auth/session']),
    );
    expect(document.title).toBe('All good · testnode');
    expect(root.dataset.level).toBe('ok');
    expect(root.dataset.fresh).toBe('fresh');
    expect(root.lang).toBe('en');
    expect(w.find('h1').text()).toContain('testnode');
    expect(w.find('.log-line.tip').exists()).toBe(true);
    expect(w.findComponent(VolumeCard).exists()).toBe(true);
    expect(w.findComponent(FeeCard).exists()).toBe(true);
    const footer = w.find('footer');
    expect(footer.text()).toContain('read-only access · data every 21 s, log every 3 s');
    expect(footer.text()).toContain('· v4.0.0-test');
    // the current language is plain text, the other one a button
    expect(footer.findAll('button').map((b) => b.text())).toEqual(['de']);
  });

  it('switches the language, remembers it and retitles the page', async () => {
    const { w } = await render(snapshot());
    await w.find('footer button').trigger('click');
    expect(i18n.global.locale.value).toBe('de');
    expect(localStorage.getItem('btcnode.locale')).toBe('de');
    expect(root.lang).toBe('de');
    expect(document.title).toBe('Alles läuft · testnode');
    expect(
      w
        .find('footer')
        .findAll('button')
        .map((b) => b.text()),
    ).toEqual(['en']);
  });

  it('switches the language even when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    const { w } = await render(snapshot());
    await w.find('footer button').trigger('click');
    expect(i18n.global.locale.value).toBe('de');
  });

  it('puts the sync percentage into the title and hides the 24-hour charts', async () => {
    const s = snapshot();
    const { w } = await render(
      snapshot({
        state: { level: 'sync', warnings: [] },
        node: { ...s.node!, inSync: false, verificationProgress: 0.4567 },
      }),
    );
    expect(document.title).toBe('45.67 % · testnode');
    expect(root.dataset.level).toBe('sync');
    expect(w.findComponent(VolumeCard).exists()).toBe(false);
    expect(w.findComponent(FeeCard).exists()).toBe(false);
  });

  it.each<[StatusSnapshot['state'], string]>([
    [{ level: 'warn', warnings: [{ code: 'power' }] }, 'One notice · testnode'],
    [{ level: 'warn', warnings: [{ code: 'power' }, { code: 'cpu' }] }, '2 notices · testnode'],
    [{ level: 'error', warnings: [] }, 'Not reachable · testnode'],
    [{ level: 'starting', warnings: [] }, 'Bitcoin Core is starting · testnode'],
    [{ level: 'stale', warnings: [], staleFor: 60 }, 'Node answering slowly · testnode'],
  ])('titles the page for state %j', async (state, title) => {
    await render(snapshot({ state }));
    expect(document.title).toBe(title);
    expect(root.dataset.level).toBe(state.level);
  });

  it('keeps the title and marks no data while the backend does not answer', async () => {
    const { w } = await render(null);
    expect(document.title).toBe('btcnode');
    expect(root.dataset.level).toBe('starting');
    expect(root.dataset.fresh).toBe('none');
    expect(w.find('footer').text()).not.toContain('read-only access');
    expect(useStatusStore().backendDown).toBe(true);
  });

  it('marks the data stale when a later poll fails', async () => {
    const { api } = await render(snapshot());
    api.set(null);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(root.dataset.fresh).toBe('stale');
  });

  it('follows the log interval the backend announces', async () => {
    const { api } = await render(snapshot({ intervals: { status: 21, log: 5 } }));
    expect(useLogStore().interval).toBe(5);
    const before = api.fetch.mock.calls.filter((c) => c[0] === '/api/log').length;
    await vi.advanceTimersByTimeAsync(5000);
    const after = api.fetch.mock.calls.filter((c) => c[0] === '/api/log').length;
    expect(after).toBe(before + 1);
  });

  it('stops polling when unmounted', async () => {
    const { w, api } = await render(snapshot());
    w.unmount();
    const calls = api.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.fetch.mock.calls.length).toBe(calls);
  });
});

import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlMenu from '@/components/control/ControlMenu.vue';
import AppHeader from '@/components/layout/AppHeader.vue';
import ChronicleTerminal from '@/components/layout/ChronicleTerminal.vue';
import { useAuthStore } from '@/stores/auth';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { NOW, snapshot } from '@/test/snapshot';

// the template's /bitcoin.png lives in public/, which vitest cannot import
vi.mock('/bitcoin.png', () => ({ default: '/bitcoin.png' }));

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

async function render(
  s: StatusSnapshot | null,
  opts: { backendDown?: boolean; controlAvailable?: boolean; locale?: 'en' | 'de' } = {},
) {
  const { global } = setup(opts.locale);
  const status = useStatusStore();
  status.snapshot = s;
  status.backendDown = opts.backendDown ?? false;
  useAuthStore().controlAvailable = opts.controlAvailable ?? false;
  const w = mount(AppHeader, { global });
  await vi.advanceTimersByTimeAsync(1000);
  return w;
}

const info = (w: Awaited<ReturnType<typeof render>>) => w.find('.header-info');

describe('AppHeader', () => {
  it('shows host, versions with an available update, uptime and the time stamp', async () => {
    const w = await render(snapshot());
    expect(w.find('h1').text()).toBe('testnode · Bitcoin Fullnode');
    expect(info(w).text()).toBe('Core 31.1 · electrs 0.11.1 → 0.11.2 · up for 38 min');
    expect(info(w).classes()).toContain('warn');
    expect(info(w).attributes('title')).toBe('versions checked 21 min ago');
    expect(w.find('.header-right').text()).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(w.findComponent(ChronicleTerminal).exists()).toBe(true);
    expect(w.findComponent(ControlMenu).exists()).toBe(false);
  });

  it('is calm when everything is current and notes a check in the clear', async () => {
    const s = snapshot();
    const w = await render(
      snapshot({
        updates: {
          checkedAt: NOW - 30,
          viaTor: false,
          entries: [
            { name: 'Bitcoin Core', installed: '31.1', latest: '31.1', outdated: false },
            { name: 'electrs', installed: '0.11.1', latest: null, outdated: true },
          ],
        },
        node: { ...s.node!, uptime: 0 },
      }),
    );
    expect(info(w).text()).toBe('Core 31.1 · electrs 0.11.1');
    expect(info(w).classes()).not.toContain('warn');
    expect(info(w).attributes('title')).toBe('versions checked 31 s ago, fetched in the clear');
  });

  it('falls back to the user agent without an update check', async () => {
    const w = await render(snapshot({ updates: null }));
    expect(info(w).text()).toBe('Satoshi:31.1.0 · up for 38 min');
    expect(info(w).attributes('title')).toBeUndefined();
  });

  it('hides the info line when there is nothing to say', async () => {
    const w = await render(snapshot({ updates: null, node: null }));
    expect(info(w).exists()).toBe(false);
    expect(w.find('h1').text()).toBe('testnode · Bitcoin Fullnode');
  });

  it('waits for data, then reports an unreachable backend', async () => {
    const waiting = await render(null);
    expect(waiting.find('.header-right').text()).toBe('waiting for the first data');
    expect(waiting.find('h1').text()).toBe('· Bitcoin Fullnode');
    const down = await render(null, { backendDown: true });
    expect(down.find('.header-right').text()).toBe('backend not reachable');
  });

  it('offers the control menu when the host has an agent', async () => {
    const w = await render(snapshot(), { controlAvailable: true });
    expect(w.findComponent(ControlMenu).exists()).toBe(true);
  });

  it('writes the time stamp the German way', async () => {
    const w = await render(snapshot(), { locale: 'de' });
    expect(w.find('.header-right').text()).toMatch(/^\d\d\.\d\d\.\d{4} \d\d:\d\d:\d\d$/);
  });
});

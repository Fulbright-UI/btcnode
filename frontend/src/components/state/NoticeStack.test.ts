import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoticeStack from '@/components/state/NoticeStack.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { NOW, snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type State = StatusSnapshot['state'];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

async function render(
  s: StatusSnapshot | null,
  store: { backendDown?: boolean; fetchedAt?: number | null } = {},
  locale: 'en' | 'de' = 'en',
) {
  const { global } = setup(locale);
  const status = useStatusStore();
  status.snapshot = s;
  status.backendDown = store.backendDown ?? false;
  status.fetchedAt = store.fetchedAt ?? null;
  const w = mount(NoticeStack, { global });
  await vi.advanceTimersByTimeAsync(1000);
  return w;
}

const withState = (state: Partial<State>) =>
  snapshot({ state: { level: 'ok', warnings: [], ...state } });

const notices = (w: Awaited<ReturnType<typeof render>>) =>
  w.findAll('.notice').map((n) => n.text().replace(/\s+/g, ' '));

describe('NoticeStack', () => {
  it('is empty for a healthy node', async () => {
    const w = await render(snapshot());
    expect(w.find('.notices').element.children).toHaveLength(0);
  });

  it('reports a backend that went away with the age of the last update', async () => {
    const w = await render(snapshot(), { backendDown: true, fetchedAt: NOW - 120 });
    expect(notices(w)).toEqual([
      'Dashboard backend not reachable The page cannot fetch new data. Last successful update 2 min ago.',
    ]);
    // the age keeps counting
    vi.setSystemTime((NOW + 7200) * 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(notices(w)[0]).toContain('Last successful update 2 h ago.');
  });

  it('stays quiet about the backend before the first successful fetch', async () => {
    const w = await render(null, { backendDown: true, fetchedAt: null });
    expect(notices(w)).toEqual([]);
  });

  it('passes on the warmup message while Core starts', async () => {
    const w = await render(withState({ level: 'starting', warmupMessage: 'Loading block index…' }));
    expect(notices(w)).toEqual([
      'Bitcoin Core is starting up. It reports: Loading block index… The figures shown are from before the restart.',
    ]);
  });

  it('says there is no answer yet while starting without a message', async () => {
    const w = await render(withState({ level: 'starting' }));
    expect(notices(w)[0]).toMatch(/^No answer from the node yet\. This display has just started/);
  });

  it('explains stale values with their age', async () => {
    const w = await render(withState({ level: 'stale', staleFor: 300 }));
    expect(notices(w)[0]).toMatch(
      /^The node is not answering right now\. Shown is the last measured state from 5 min ago\./,
    );
    const noAge = await render(withState({ level: 'stale' }));
    expect(notices(noAge)[0]).toContain('from 0 s ago.');
  });

  it('shows the red card with advice for an unreachable node', async () => {
    const w = await render(
      withState({ level: 'error', error: { kind: 'unreachable', message: 'ECONNREFUSED' } }),
    );
    const card = w.find('.error-card');
    expect(card.find('h2').text()).toBe('Node not reachable');
    const [message, advice] = card.findAll('p');
    expect(message!.text()).toBe('ECONNREFUSED');
    expect(advice!.text()).toBe(
      'Check with systemctl status bitcoind or journalctl -u bitcoind -n 50.',
    );
    expect(advice!.findAll('code')).toHaveLength(2);
  });

  it('points at rpcauth when the node refuses the login', async () => {
    const w = await render(withState({ level: 'error', error: { kind: 'auth', message: '401' } }));
    expect(w.find('.error-card h2').text()).toBe('Node refused the login');
    expect(w.find('.error-card code').text()).toBe('rpcauth');
  });

  it('points at the whitelist for an RPC error', async () => {
    const w = await render(
      withState({ level: 'error', error: { kind: 'rpc', message: 'Method not found' } }),
    );
    expect(w.find('.error-card h2').text()).toBe('Node answers with an error');
    expect(w.find('.error-card p').text()).toBe('Method not found');
    expect(w.find('.error-card code').text()).toBe('rpcwhitelist');
  });

  it('shows no red card for an error level without details', async () => {
    const w = await render(withState({ level: 'error' }));
    expect(w.find('.error-card').exists()).toBe(false);
  });

  it('lists every missing log unit', async () => {
    const w = await render(snapshot({ logUnitsMissing: ['electrs', 'tor'] }));
    expect(notices(w)).toEqual([
      'No systemd unit electrs.service found. The log panel stays empty.',
      'No systemd unit tor.service found. The log panel stays empty.',
    ]);
    expect(w.findAll('.notice code').map((c) => c.text())).toEqual([
      'electrs.service',
      'tor.service',
    ]);
  });

  it('speaks German', async () => {
    const w = await render(
      withState({ level: 'error', error: { kind: 'auth', message: 'x' } }),
      {},
      'de',
    );
    expect(w.find('.error-card h2').text()).toBe('Anmeldung am Node abgelehnt');
  });
});

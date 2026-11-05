import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FillBar from '@/components/charts/FillBar.vue';
import HashrateCurve from '@/components/state/HashrateCurve.vue';
import ProgressCurve from '@/components/state/ProgressCurve.vue';
import StateBar from '@/components/state/StateBar.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { NOW, snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type State = StatusSnapshot['state'];
type Node = NonNullable<StatusSnapshot['node']>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

async function render(s: StatusSnapshot | null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  useStatusStore().snapshot = s;
  const w = mount(StateBar, { global });
  // let the shared clock pick up the faked time
  await vi.advanceTimersByTimeAsync(1000);
  return w;
}

function withState(state: Partial<State>, node: Partial<Node> = {}): StatusSnapshot {
  const s = snapshot();
  return snapshot({
    state: { level: 'ok', warnings: [], ...state },
    node: { ...s.node!, ...node },
  });
}

const word = (w: Awaited<ReturnType<typeof render>>) => w.find('.state-word').text();
const extra = (w: Awaited<ReturnType<typeof render>>) => w.find('.state-extra').text();
const label = (w: Awaited<ReturnType<typeof render>>) => w.find('.state-label').text();

describe('StateBar', () => {
  it('says all is good, with the height and the age of the tip', async () => {
    const w = await render(snapshot());
    expect(word(w)).toBe('All good');
    expect(extra(w)).toBe('Node in sync, nothing unusual');
    expect(w.find('.state-number').text()).toBe('915,312');
    expect(label(w)).toBe('Block · 4 min ago');
    // the hashrate history is still filling
    expect(w.findComponent(HashrateCurve).exists()).toBe(false);
    expect(w.find('.hashrate-ticker').exists()).toBe(false);
    expect(w.find('.progress-box').exists()).toBe(false);
  });

  it('ages the tip as the clock ticks and falls back to the miner time', async () => {
    const w = await render(withState({}, { tipArrivedAt: null, tipTime: NOW - 100 }));
    expect(label(w)).toBe('Block · 1 min ago');
    vi.setSystemTime((NOW + 7200) * 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(label(w)).toBe('Block · 2 h ago');
  });

  it('shows the plain height label without a tip time', async () => {
    const w = await render(withState({}, { tipArrivedAt: null, tipTime: null }));
    expect(label(w)).toBe('Block height');
  });

  it('shows the hashrate and its change over a year once complete', async () => {
    const s = snapshot();
    const w = await render(snapshot({ hashrate: { ...s.hashrate, complete: true } }));
    expect(w.findComponent(HashrateCurve).props('points')).toHaveLength(3);
    expect(w.find('.hashrate-ticker b').text()).toBe('135 EH/s');
    const delta = w.find('.hashrate-delta');
    expect(delta.text()).toBe('+3.8 %');
    expect(delta.classes()).toContain('good');
    expect(w.find('.hashrate-label').text()).toBe('vs. a year ago · hashrate, curve since 2009');
  });

  it('marks a falling hashrate', async () => {
    const w = await render(
      snapshot({
        hashrate: {
          points: [
            [1, 2e20],
            [2, 1.5e20],
            [3, 1e20],
          ],
          yearPeriods: 1,
          complete: true,
        },
      }),
    );
    const delta = w.find('.hashrate-delta');
    expect(delta.text()).toBe('−33.3 %');
    expect(delta.classes()).toContain('warn');
  });

  it('shows the sync progress instead of a headline', async () => {
    const s = withState(
      { level: 'sync' },
      {
        blocks: 500_000,
        verificationProgress: 0.5,
        inSync: false,
        sync: { ratePerHour: 1.25, remainingSeconds: 7200, history: [] },
      },
    );
    const w = await render(snapshot({ ...s, hashrate: { ...s.hashrate, complete: true } }));
    expect(word(w)).toBe('50.00 %');
    expect(extra(w)).toMatch(/^Syncing the blockchain · verified through \d{4}-\d\d-\d\d$/);
    expect(w.find('.state-number').text()).toBe('500,000');
    expect(label(w)).toBe('of 915,312 blocks');
    expect(w.findComponent(FillBar).props()).toMatchObject({ fraction: 0.5, height: 10 });
    expect(w.findAll('.progress-foot span').map((s) => s.text())).toEqual([
      '1.25 pp/h',
      'about 2 h 0 min left',
    ]);
    expect(w.findComponent(ProgressCurve).props('history')).toEqual([]);
    // no hashrate ticker during the sync, even with a complete history
    expect(w.find('.hashrate-ticker').exists()).toBe(false);
  });

  it('is still measuring the rate early in the sync and omits an unknown tip date', async () => {
    const w = await render(withState({ level: 'sync' }, { tipTime: null }));
    expect(extra(w)).toBe('Syncing the blockchain');
    expect(w.find('.progress-foot').text()).toBe('Still measuring the rate');
  });

  it.each<[Partial<State>, string, string]>([
    [{ level: 'error' }, 'Not reachable', 'Bitcoin Core is not answering'],
    [
      { level: 'starting', warmupMessage: 'Verifying blocks…' },
      'Bitcoin Core is starting',
      'Verifying blocks…',
    ],
    [{ level: 'starting' }, 'Waiting for Bitcoin Core', 'No answer since this display started'],
    [
      { level: 'stale', staleFor: 150 },
      'Node answering slowly',
      'Values shown were measured 2 min ago',
    ],
    [{ level: 'stale' }, 'Node answering slowly', 'Values shown were measured 0 s ago'],
    [
      { level: 'warn', warnings: [{ code: 'temperature', params: { value: 71 } }] },
      'One notice',
      'Temperature: 71 °C',
    ],
    [
      { level: 'warn', warnings: [{ code: 'updatesAvailable' }, { code: 'power' }] },
      '2 notices',
      'Updates available',
    ],
    [{ level: 'warn' }, '0 notices', ''],
  ])('headline for %j', async (state, w1, w2) => {
    const w = await render(withState(state));
    expect(word(w)).toBe(w1);
    expect(extra(w)).toBe(w2);
  });

  it('waits for the first answer without a snapshot', async () => {
    const w = await render(null);
    expect(word(w)).toBe('Waiting for Bitcoin Core');
    expect(extra(w)).toBe('No answer since this display started');
    expect(w.find('.state-number').text()).toBe('0');
    expect(label(w)).toBe('Block height');
  });

  it('shows the headline without node data', async () => {
    const w = await render(snapshot({ node: null, state: { level: 'sync', warnings: [] } }));
    expect(w.find('.progress-box').exists()).toBe(false);
    expect(label(w)).toBe('Block height');
  });

  it('formats the progress the German way', async () => {
    const w = await render(withState({ level: 'sync' }, { verificationProgress: 0.12345 }), 'de');
    expect(word(w)).toBe('12,35 %');
  });
});

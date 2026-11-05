import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import CopyField from '@/components/cards/CopyField.vue';
import NetworkElectrumCard from '@/components/cards/NetworkElectrumCard.vue';
import FillBar from '@/components/charts/FillBar.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type Electrum = StatusSnapshot['electrum'];
type Node = NonNullable<StatusSnapshot['node']>;

function render(s: StatusSnapshot | null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  useStatusStore().snapshot = s;
  return mount(NetworkElectrumCard, { global });
}

function withElectrum(over: Partial<Electrum>): StatusSnapshot {
  const s = snapshot();
  return snapshot({ electrum: { ...s.electrum, ...over } });
}

function withNode(over: Partial<Node>): StatusSnapshot {
  const s = snapshot();
  return snapshot({ node: { ...s.node!, ...over } });
}

/** dt text to dd text, for the column with the given heading */
function rows(w: ReturnType<typeof render>, column: number): Record<string, string> {
  const col = w.findAll('.column')[column]!;
  const out: Record<string, string> = {};
  for (const dt of col.findAll('dt')) {
    out[dt.text()] = (dt.element.nextElementSibling as HTMLElement).textContent!.trim();
  }
  return out;
}

describe('NetworkElectrumCard', () => {
  it('shows chain, mempool and a fully indexed Electrum server', () => {
    const w = render(snapshot());
    expect(w.find('h2').text()).toBe('Network & Electrum');
    expect(w.findAll('h3').map((h) => h.text())).toEqual(['Chain & Mempool', 'Electrum']);
    expect(rows(w, 0)).toMatchObject({
      Difficulty: '126.3 T',
      'next adjustment': 'in 1,968 blocks',
      'Memory use': '198.8 MB of 300.0 MB',
      'fees waiting': '0.42 BTC',
    });
    expect(rows(w, 1)).toEqual({ Service: 'running', Responding: 'yes', Index: 'complete' });
    const bars = w.findAllComponents(FillBar);
    expect(bars[0]!.props()).toMatchObject({ level: '' });
    expect(bars[0]!.props('fraction')).toBeCloseTo(198.8 / 300);
    expect(bars[1]!.props()).toMatchObject({
      fraction: 1,
      level: '',
      title: '915,312 of 915,312 blocks',
    });
    const copies = w.findAllComponents(CopyField);
    expect(copies.map((c) => c.props())).toEqual([
      { label: 'On the local network', value: '10.0.0.5:50001' },
      { label: 'Over Tor', value: 'electrsexample.onion:50001' },
    ]);
    expect(w.find('.card-foot').text()).toBe('Enter this in your wallet as a custom server.');
  });

  it('flags a nearly full mempool and copes with an unknown maximum', () => {
    const full = render(
      withNode({ mempool: { txCount: 1, usage: 290e6, maxUsage: 300e6, totalFee: 0 } }),
    );
    expect(full.findAllComponents(FillBar)[0]!.props('level')).toBe('warn');

    const unknown = render(
      withNode({ mempool: { txCount: 1, usage: 5e6, maxUsage: 0, totalFee: 0 } }),
    );
    expect(rows(unknown, 0)['Memory use']).toBe('5.0 MB');
    expect(unknown.findAllComponents(FillBar)[0]!.props('fraction')).toBe(0);
  });

  it('counts the missing blocks when the index is just behind the tip', () => {
    const w = render(withElectrum({ indexedHeight: 915_312 - 100 }));
    const index = w.findAll('.column')[1]!.findAll('dd')[2]!;
    expect(index.text()).toBe('100 blocks to go');
    expect(index.classes()).toContain('warn');
    expect(w.findAllComponents(FillBar)[1]!.props('level')).toBe('warn');
  });

  it('shows a percentage while the index is far behind', () => {
    const w = render(withElectrum({ indexedHeight: 457_656 }));
    expect(rows(w, 1).Index).toBe('50.0 %');
    expect(w.findAllComponents(FillBar)[1]!.props('fraction')).toBeCloseTo(0.5);
  });

  it('says the progress is unreadable for a known unit without a height', () => {
    const w = render(withElectrum({ indexedHeight: null, knownByUnit: true }));
    const index = w.findAll('.column')[1]!.findAll('dd')[2]!;
    expect(index.text()).toBe('progress not readable');
    expect(index.classes()).toContain('faint');
    expect(w.findAllComponents(FillBar)).toHaveLength(1);
  });

  it('calls a port-only server without a height ready', () => {
    const w = render(withElectrum({ indexedHeight: null, knownByUnit: false }));
    expect(rows(w, 1).Index).toBe('ready');
  });

  it('shows a stopped, unresponsive server without an index row', () => {
    const w = render(
      withElectrum({
        indexedHeight: null,
        running: false,
        reachable: false,
        lanAddress: null,
        onionAddress: null,
      }),
    );
    expect(rows(w, 1)).toEqual({ Service: 'stopped', Responding: 'no, still indexing' });
    expect(w.findAll('.column')[1]!.findAll('dd.warn')).toHaveLength(2);
    expect(w.find('.copy-block').exists()).toBe(false);
    expect(w.find('.card-foot').text()).toBe('Enter this in your wallet as a custom server.');
  });

  it('offers only the addresses that exist', () => {
    const w = render(withElectrum({ onionAddress: null }));
    expect(w.findAllComponents(CopyField)).toHaveLength(1);
  });

  it('explains what is missing when no Electrum server is set up', () => {
    const w = render(withElectrum({ configured: false, port: 50002 }));
    expect(rows(w, 1)).toEqual({ Service: 'none set up', Wallet: 'asks foreign servers' });
    expect(w.findAllComponents(CopyField)).toHaveLength(0);
    expect(w.find('.card-foot').text()).toContain('No Electrum server found on port 50002.');
  });

  it('shows only the Electrum column without node data', () => {
    const w = render(snapshot({ node: null }));
    expect(w.find('h2').text()).toBe('Electrum server');
    expect(w.findAll('.column')).toHaveLength(1);
    expect(w.find('h3').text()).toBe('Electrum');
    // no tip to compare the indexed height with
    expect(rows(w, 0).Index).toBe('progress not readable');
  });

  it('renders only the heading without a snapshot', () => {
    const w = render(null);
    expect(w.find('h2').text()).toBe('Electrum server');
    expect(w.findAll('.column')).toHaveLength(0);
    expect(w.find('.card-foot').exists()).toBe(false);
  });

  it('formats numbers the German way', () => {
    const w = render(snapshot(), 'de');
    expect(rows(w, 0)['Schwierigkeit']).toBe('126,3 T');
  });
});

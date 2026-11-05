import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import VolumeCard from '@/components/cards/VolumeCard.vue';
import ChartLegend from '@/components/charts/ChartLegend.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import SkeletonChart from '@/components/charts/SkeletonChart.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { NOW, snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type Block = StatusSnapshot['blocks24h'][number];

function blocks(outs: number[], spacing = 600): Block[] {
  return outs.map((totalOut, i) => ({
    height: 2000 + i,
    time: NOW - (outs.length - i) * spacing,
    totalOut,
    medianFee: 2,
    txCount: 10,
  }));
}

function render(s: StatusSnapshot | null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  useStatusStore().snapshot = s;
  return mount(VolumeCard, { global });
}

const values = (w: ReturnType<typeof render>) => w.findAll('dd').map((d) => d.text());

describe('VolumeCard', () => {
  it('sums up the volume of the last day and tints each block against the mean', () => {
    const w = render(snapshot());
    expect(w.find('h2').text()).toBe('Volume · 24 hours');
    expect(values(w)).toEqual(['7,473 BTC', '25,377', '6 · 1 h']);
    expect(w.find('.chart-label').text()).toBe('Volume per block · peak 1,338 BTC');
    const chart = w.findComponent(ColumnChart);
    expect(chart.props('label')).toBe('Volume moved per block over the last 24 hours');
    const cols = chart.props('columns');
    expect(cols).toHaveLength(6);
    expect(cols.map((c) => c.colour)).toEqual([
      'col-tier-1',
      'col-tier-1',
      'col-tier-1',
      'col-tier-2',
      'col-tier-2',
      'col-tier-2',
    ]);
    expect(cols[0]!.title).toBe('Block 915,307 · 1,153 BTC · 4,197 transactions');
    expect(
      w
        .findComponent(ChartLegend)
        .props('entries')
        .map((e) => e.text),
    ).toEqual(['below the 24 h mean', 'up to twice the mean', 'above that']);
    expect(w.find('.card-foot').exists()).toBe(false);
  });

  it('puts a block far above the mean in the top tier and shows small sums with decimals', () => {
    const w = render(snapshot({ blocks24h: blocks([1e8, 1e8, 1e9]) }));
    expect(values(w)[0]).toBe('12.00 BTC');
    const cols = w.findComponent(ColumnChart).props('columns');
    expect(cols.map((c) => c.colour)).toEqual(['col-tier-1', 'col-tier-1', 'col-tier-3']);
  });

  it('copes with empty blocks and blocks with the same timestamp', () => {
    const w = render(snapshot({ blocks24h: blocks([0, 0, 0], 0) }));
    expect(values(w)).toEqual(['0.00 BTC', '30', '3 · 0 h']);
    const cols = w.findComponent(ColumnChart).props('columns');
    expect(cols.every((c) => c.colour === 'col-tier-1')).toBe(true);
  });

  it('waits with a column skeleton until there are three blocks', () => {
    const w = render(snapshot({ blocks24h: blocks([1, 2]) }));
    expect(values(w)).toEqual(['—', '—', '—']);
    expect(w.findAll('dd.faint')).toHaveLength(3);
    expect(w.find('.chart-label').text()).toBe('Volume per block');
    expect(w.findComponent(SkeletonChart).props()).toMatchObject({
      label: 'Volume per block',
      columns: true,
    });
    expect(w.find('.card-foot').exists()).toBe(true);
    expect(render(null).findComponent(SkeletonChart).exists()).toBe(true);
  });

  it('speaks German', () => {
    const w = render(snapshot(), 'de');
    expect(values(w)[0]).toBe('7.473 BTC');
  });
});

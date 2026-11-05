import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import FeeCard from '@/components/cards/FeeCard.vue';
import ChartLegend from '@/components/charts/ChartLegend.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import SkeletonChart from '@/components/charts/SkeletonChart.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { NOW, snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type Block = StatusSnapshot['blocks24h'][number];

function blocks(fees: number[]): Block[] {
  return fees.map((medianFee, i) => ({
    height: 1000 + i,
    time: NOW - (fees.length - i) * 600,
    totalOut: 1e10,
    medianFee,
    txCount: 100,
  }));
}

function render(s: StatusSnapshot | null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  useStatusStore().snapshot = s;
  return mount(FeeCard, { global });
}

const values = (w: ReturnType<typeof render>) => w.findAll('dd').map((d) => d.text());

describe('FeeCard', () => {
  it('sums up the fees of the last day and draws one tinted bar per block', () => {
    const w = render(snapshot());
    expect(w.find('h2').text()).toBe('Fee history · 24 hours');
    expect(values(w)).toEqual(['3.0 sat/vB', '3.2 sat/vB', '2 to 5 sat/vB']);
    expect(w.findAll('dd.faint')).toHaveLength(0);
    expect(w.find('.chart-label').text()).toBe('average fee per block · peak 5.0 sat/vB');
    const chart = w.findComponent(ColumnChart);
    expect(chart.props('label')).toBe('Average fee per block over the last 24 hours');
    const cols = chart.props('columns');
    expect(cols.map((c) => c.value)).toEqual([2, 3, 4, 5, 2, 3]);
    expect(cols.map((c) => c.colour)).toEqual([
      'col-tier-1',
      'col-tier-2',
      'col-tier-2',
      'col-tier-2',
      'col-tier-1',
      'col-tier-2',
    ]);
    expect(cols[0]!.title).toBe('Block 915,307 · 2.0 sat/vB');
    expect(
      w
        .findComponent(ChartLegend)
        .props('entries')
        .map((e) => e.text),
    ).toEqual(['up to 2 sat/vB', 'up to 5 sat/vB', 'above 5 sat/vB']);
    expect(w.find('.card-foot').exists()).toBe(false);
  });

  it('rounds fees to whole bars and tints high fees in the top tier', () => {
    const w = render(snapshot({ blocks24h: blocks([0.4, 7.6, 12]) }));
    const cols = w.findComponent(ColumnChart).props('columns');
    expect(cols.map((c) => c.value)).toEqual([0, 8, 12]);
    expect(cols.map((c) => c.colour)).toEqual(['col-tier-1', 'col-tier-3', 'col-tier-3']);
    expect(cols[1]!.title).toBe('Block 1,001 · 7.6 sat/vB');
  });

  it('leaves blocks without a known fee out of average and range', () => {
    const w = render(snapshot({ blocks24h: blocks([0, 4, 6]) }));
    expect(values(w)).toEqual(['6.0 sat/vB', '5.0 sat/vB', '4 to 6 sat/vB']);
    const zero = render(snapshot({ blocks24h: blocks([0, 0, 0]) }));
    expect(values(zero)).toEqual(['0.0 sat/vB', '0.0 sat/vB', '0 to 0 sat/vB']);
  });

  it('waits with a skeleton until there are three blocks', () => {
    const w = render(snapshot({ blocks24h: blocks([1, 2]) }));
    expect(values(w)).toEqual(['—', '—', '—']);
    expect(w.findAll('dd.faint')).toHaveLength(3);
    expect(w.find('.chart-label').text()).toBe('average fee per block');
    expect(w.findComponent(ColumnChart).exists()).toBe(false);
    expect(w.findComponent(SkeletonChart).props()).toMatchObject({
      label: 'average fee per block',
      columns: false,
    });
    expect(w.find('.card-foot').text()).toMatch(/^Appears once the chain is up to date\./);
    expect(render(null).findAll('dd.faint')).toHaveLength(3);
  });

  it('speaks German', () => {
    const w = render(snapshot(), 'de');
    expect(values(w)[1]).toBe('3,2 sat/vB');
  });
});

import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ChartLegend from '@/components/charts/ChartLegend.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import FillBar from '@/components/charts/FillBar.vue';
import SkeletonChart from '@/components/charts/SkeletonChart.vue';
import { setup } from '@/test/mount';

enableAutoUnmount(afterEach);

describe('ChartLegend', () => {
  it('renders one swatch per entry with its colour class and text', () => {
    const w = mount(ChartLegend, {
      props: {
        entries: [
          { colour: 'tier-1', text: 'low' },
          { colour: 'tier-2', text: 'high' },
        ],
      },
    });
    const items = w.findAll('.chart-legend > span');
    expect(items.map((s) => s.text())).toEqual(['low', 'high']);
    expect(w.find('i.swatch.tier-2').exists()).toBe(true);
  });
});

describe('ColumnChart', () => {
  it('draws one bar per column with colour class, tooltip and aria label', () => {
    const w = mount(ColumnChart, {
      props: {
        label: 'Fees per block',
        columns: [
          { value: 1, colour: 'col-a', title: 'first' },
          { value: 3, colour: 'col-b' },
          { value: 2, colour: 'col-c', title: 'third' },
        ],
      },
    });
    expect(w.attributes('aria-label')).toBe('Fees per block');
    expect(w.attributes('role')).toBe('img');
    const rects = w.findAll('rect');
    expect(rects).toHaveLength(3);
    expect(rects.map((r) => r.classes()[0])).toEqual(['col-a', 'col-b', 'col-c']);
    expect(w.findAll('title').map((t) => t.text())).toEqual(['first', 'third']);
    // the largest value fills the full chart height
    expect(rects[1]!.attributes('height')).toBe('38.00');
  });

  it('draws nothing for fewer than two columns', () => {
    const w = mount(ColumnChart, { props: { label: 'x', columns: [{ value: 1, colour: 'c' }] } });
    expect(w.findAll('rect')).toHaveLength(0);
  });

  it('honours a fixed floor and ceiling', () => {
    const w = mount(ColumnChart, {
      props: {
        label: 'temp',
        floor: 30,
        ceiling: 90,
        columns: [
          { value: 60, colour: 'a' },
          { value: 90, colour: 'b' },
        ],
      },
    });
    const [half, full] = w.findAll('rect');
    expect(half!.attributes('height')).toBe('19.00');
    expect(full!.attributes('height')).toBe('38.00');
  });
});

describe('FillBar', () => {
  it('fills to the fraction and shows the percentage as tooltip by default', () => {
    const w = mount(FillBar, { props: { fraction: 0.425 } });
    const rect = w.find('rect');
    expect(rect.attributes('width')).toBe('42.50');
    expect(rect.attributes('height')).toBe('6');
    expect(w.find('title').text()).toBe('43 %');
    expect(w.find('svg').attributes('aria-label')).toBe('43 %');
    expect(w.classes()).toContain('h6');
  });

  it('clamps the fraction and applies level, height and title', () => {
    const w = mount(FillBar, {
      props: { fraction: 1.7, level: 'error', height: 10, title: 'disk full' },
    });
    expect(w.find('rect').attributes('width')).toBe('100.00');
    expect(w.find('rect').classes()).toContain('error');
    expect(w.classes()).toContain('h10');
    expect(w.find('title').text()).toBe('disk full');
    const empty = mount(FillBar, { props: { fraction: -1 } });
    expect(empty.find('rect').attributes('width')).toBe('0.00');
  });
});

describe('SkeletonChart', () => {
  it('draws a flat line labelled "no data yet" by default', () => {
    const { global } = setup();
    const w = mount(SkeletonChart, { global });
    expect(w.attributes('aria-label')).toBe('no data yet');
    expect(w.findAll('line')).toHaveLength(1);
    expect(w.findAll('rect')).toHaveLength(0);
  });

  it('draws 24 stub columns when asked, with the given label and size', () => {
    const { global } = setup('de');
    const w = mount(SkeletonChart, {
      global,
      props: { columns: true, label: 'Temperatur', width: 300, height: 54 },
    });
    expect(w.attributes('aria-label')).toBe('Temperatur');
    expect(w.attributes('viewBox')).toBe('0 0 300 54');
    expect(w.findAll('rect.skeleton-part')).toHaveLength(24);
    expect(w.find('line').exists()).toBe(false);
  });

  it('uses the German fallback label', () => {
    const { global } = setup('de');
    const w = mount(SkeletonChart, { global });
    expect(w.attributes('aria-label')).toBe('noch keine Daten');
  });
});

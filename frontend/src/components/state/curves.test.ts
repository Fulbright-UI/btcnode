import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import HashrateCurve from '@/components/state/HashrateCurve.vue';
import ProgressCurve from '@/components/state/ProgressCurve.vue';
import { setup } from '@/test/mount';

enableAutoUnmount(afterEach);

describe('HashrateCurve', () => {
  it('draws one polyline point per positive hashrate and closes the area', () => {
    const w = mount(HashrateCurve, {
      props: {
        points: [
          [1, 0],
          [2, 1e18],
          [3, 2e18],
          [4, 4e18],
        ],
      },
    });
    expect(w.attributes('aria-hidden')).toBe('true');
    const line = w.find('polyline').attributes('points')!.split(' ');
    // the zero is dropped, the last point is the highest and sits at the top margin
    expect(line).toHaveLength(3);
    expect(line[2]).toBe('600.0,18.0');
    const area = w.find('polygon').attributes('points')!;
    expect(area.startsWith('0,120 ')).toBe(true);
    expect(area.endsWith(' 600,120')).toBe(true);
  });

  it('renders nothing with fewer than two usable points', () => {
    const w = mount(HashrateCurve, { props: { points: [[1, 5e18]] } });
    expect(w.find('svg').exists()).toBe(false);
  });
});

describe('ProgressCurve', () => {
  it('draws the history with span and gain in the label and the foot', () => {
    const { global } = setup();
    const w = mount(ProgressCurve, {
      global,
      props: {
        history: [
          [0, 0.1],
          [1800, 0.15],
          [3600, 0.2],
        ],
      },
    });
    expect(w.find('polyline').attributes('points')!.split(' ')).toHaveLength(3);
    expect(w.find('svg').attributes('aria-label')).toBe('1 h 0 min · +10.00 pp');
    expect(w.find('.curve-foot').text()).toBe('1 h 0 min · +10.00 pp');
  });

  it('shows the skeleton and the waiting note with too little history', () => {
    const { global } = setup();
    const w = mount(ProgressCurve, { global, props: { history: [[0, 0.1]] } });
    expect(w.find('polyline').exists()).toBe(false);
    expect(w.find('svg.skeleton').attributes('aria-label')).toBe('History, still measuring');
    expect(w.find('.curve-foot').text()).toBe('History appears after about 15 minutes');
  });

  it('treats a flat or time-reversed history as not yet measurable', () => {
    const { global } = setup('de');
    const flat = mount(ProgressCurve, {
      global,
      props: {
        history: [
          [0, 0.5],
          [10, 0.5],
          [20, 0.5],
        ],
      },
    });
    expect(flat.find('.curve-foot').text()).toBe('Verlauf ab etwa 15 Minuten Laufzeit');
    const reversed = mount(ProgressCurve, {
      global,
      props: {
        history: [
          [20, 0.1],
          [10, 0.2],
          [0, 0.3],
        ],
      },
    });
    expect(reversed.find('svg.skeleton').exists()).toBe(true);
  });
});

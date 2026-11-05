import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import SystemCard from '@/components/cards/SystemCard.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import FillBar from '@/components/charts/FillBar.vue';
import SkeletonChart from '@/components/charts/SkeletonChart.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { NOW, snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type System = StatusSnapshot['system'];

function render(over: Partial<System> | null = {}, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  const s = snapshot();
  useStatusStore().snapshot = over === null ? null : snapshot({ system: { ...s.system, ...over } });
  return mount(SystemCard, { global });
}

function rows(w: ReturnType<typeof render>): Record<string, HTMLElement> {
  const out: Record<string, HTMLElement> = {};
  for (const dt of w.findAll('dt')) out[dt.text()] = dt.element.nextElementSibling as HTMLElement;
  return out;
}

const text = (el: HTMLElement | undefined) => el?.textContent?.trim();

describe('SystemCard', () => {
  it('shows temperature, load, memory, disk, uptime and power of a healthy Pi', () => {
    const w = render();
    expect(w.find('h2').text()).toBe('System');
    const r = rows(w);
    expect(text(r['Temperature'])).toBe('52.5 °C');
    expect(r['Temperature']!.classList.contains('warn')).toBe(false);
    expect(text(r['Load'])).toBe('12 % CPU');
    expect(text(r['Memory'])).toBe('409.6 MB of 4.1 GB');
    expect(text(r['Disk space'])).toBe('45 % used, 279.7 GB free');
    expect(text(r['Pi up for'])).toBe('13 min');
    expect(text(r['Power supply'])).toBe('stable');
    expect(r['Power supply']!.classList.contains('good')).toBe(true);

    const bars = w.findAllComponents(FillBar).map((b) => b.props());
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ fraction: 0.12, level: '', title: '12 % CPU' });
    expect(bars[1]).toMatchObject({ fraction: 0.1, level: '' });
    expect(bars[2]!.level).toBe('');
  });

  it('pads the hourly temperature chart to 24 bars, tinted by threshold', () => {
    const w = render({
      temperatureHourly: [
        { hour: NOW - 10800, peak: 50 },
        { hour: NOW - 7200, peak: 65 },
        { hour: NOW - 3600, peak: 80 },
      ],
    });
    const chart = w.findComponent(ColumnChart);
    expect(chart.props('label')).toBe('Peak temperature per hour over the last 24 hours');
    expect(chart.props()).toMatchObject({ floor: 30, ceiling: 90 });
    const cols = chart.props('columns');
    expect(cols).toHaveLength(24);
    expect(cols.slice(0, 4).map((c) => c.colour)).toEqual([
      'col-good',
      'col-warn',
      'col-error',
      'col-stub',
    ]);
    expect(cols[0]!.title).toMatch(/^\d\d:00 · peak 50\.0 °C$/);
    expect(cols[3]!.title).toBeUndefined();
    expect(w.findAll('svg.columns-chart rect')).toHaveLength(24);
  });

  it('shows a skeleton until the first hour is measured', () => {
    const w = render({ temperatureHourly: [] });
    expect(w.findComponent(ColumnChart).exists()).toBe(false);
    expect(w.findComponent(SkeletonChart).props()).toMatchObject({
      label: 'Temperature history, still measuring',
      columns: true,
    });
  });

  it('warns about heat, load, memory and a nearly full disk', () => {
    const w = render({
      temperature: 76,
      cpuPercent: 91.4,
      memory: { used: 95, total: 100 },
      disk: { used: 90, total: 100, free: 10 },
      power: { undervoltageNow: true, undervoltageSinceBoot: true, throttled: true },
    });
    const r = rows(w);
    for (const k of ['Temperature', 'Load', 'Memory', 'Disk space']) {
      expect(r[k]!.classList.contains('warn')).toBe(true);
    }
    expect(text(r['Load'])).toBe('91 % CPU');
    expect(text(r['Power supply'])).toBe('UNDERVOLTAGE NOW, undervoltage since boot, throttled');
    expect(r['Power supply']!.classList.contains('warn')).toBe(true);
    expect(w.findAllComponents(FillBar).map((b) => b.props('level'))).toEqual([
      'warn',
      'warn',
      'warn',
    ]);
  });

  it('marks a critically full disk as an error and copes with a zero size', () => {
    const critical = render({ disk: { used: 97, total: 100, free: 3 } });
    expect(critical.findAllComponents(FillBar)[2]!.props('level')).toBe('error');
    const zero = render({ disk: { used: 0, total: 0, free: 0 } });
    expect(text(rows(zero)['Disk space'])).toBe('0 % used, 0.0 B free');
  });

  it('names a single power problem', () => {
    const w = render({
      power: { undervoltageNow: false, undervoltageSinceBoot: false, throttled: true },
    });
    expect(text(rows(w)['Power supply'])).toBe('throttled');
  });

  it('leaves out every value the host does not report', () => {
    const w = render({
      temperature: null,
      cpuPercent: null,
      memory: null,
      disk: null,
      uptime: null,
      power: null,
    });
    expect(w.find('dl').exists()).toBe(true);
    expect(w.findAll('dt')).toHaveLength(0);
    expect(w.findAllComponents(FillBar)).toHaveLength(0);
  });

  it('renders only the heading without a snapshot', () => {
    const w = render(null);
    expect(w.find('h2').text()).toBe('System');
    expect(w.find('dl').exists()).toBe(false);
  });

  it('speaks German', () => {
    const w = render({}, 'de');
    expect(text(rows(w)['Temperatur'])).toBe('52,5 °C');
  });
});

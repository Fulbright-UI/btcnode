import { createI18n } from 'vue-i18n';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import { useFormat } from './useFormat';
import type { Formatter } from './useFormat';

function withLocale(locale: 'en' | 'de'): Formatter {
  let f!: Formatter;
  const Probe = defineComponent({
    setup() {
      f = useFormat();
      return () => h('div');
    },
  });
  mount(Probe, {
    global: { plugins: [createI18n({ legacy: false, locale, messages: { en, de } })] },
  });
  return f;
}

describe('number notation follows the locale', () => {
  it('writes English with commas and periods', () => {
    const f = withLocale('en');
    expect(f.integer(1234567)).toBe('1,234,567');
    expect(f.decimal(11.24, 2)).toBe('11.24');
    expect(f.bytes(381_700_000)).toBe('381.7 MB');
    expect(f.btc(142_376_00000000)).toBe('142,376 BTC');
    expect(f.btc(1_06700000)).toBe('1.07 BTC');
    expect(f.magnitude(126.3e12)).toBe('126.3 T');
    expect(f.hashrate(177e18)).toBe('177 EH/s');
    expect(f.hashrate(9.5e18)).toBe('9.5 EH/s');
    expect(f.latency(293)).toBe('293 ms');
    expect(f.latency(10_900)).toBe('10.9 s');
    expect(f.date(Date.UTC(2026, 8, 5, 12) / 1000)).toBe('2026-09-05');
  });

  it('writes German with periods and commas — both swapped', () => {
    const f = withLocale('de');
    expect(f.integer(1234567)).toBe('1.234.567');
    expect(f.decimal(11.24, 2)).toBe('11,24');
    expect(f.bytes(381_700_000)).toBe('381,7 MB');
    expect(f.btc(142_376_00000000)).toBe('142.376 BTC');
    expect(f.date(Date.UTC(2026, 8, 5, 12) / 1000)).toBe('05.09.2026');
    expect(f.duration(90_061)).toBe('1 T 1 Std');
    expect(f.age(41)).toBe('vor 41 s');
    expect(f.age(3600)).toBe('vor 60 Min');
  });
});

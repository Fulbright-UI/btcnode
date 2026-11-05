import fc from 'fast-check';
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

describe('the remaining formatters', () => {
  const f = withLocale('en');

  it('picks the time unit by size', () => {
    expect(f.duration(-5)).toBe('0 min');
    expect(f.duration(59)).toBe('0 min');
    expect(f.duration(3 * 3600 + 7 * 60)).toBe('3 h 7 min');
    expect(f.durationShort(42.9)).toBe('42 s');
    expect(f.durationShort(-1)).toBe('0 s');
    expect(f.durationShort(60)).toBe('1 min');
    expect(f.durationShort(2 * 86400 + 3600)).toBe('2 d 1 h');
  });

  it('says how long ago in the coarsest sensible unit', () => {
    expect(f.age(-3)).toBe('0 s ago');
    expect(f.age(89)).toBe('89 s ago');
    expect(f.age(90)).toBe('1 min ago');
    expect(f.age(5399)).toBe('89 min ago');
    expect(f.age(5400)).toBe('1 h ago');
    expect(f.age(172_799)).toBe('47 h ago');
    expect(f.age(172_800)).toBe('2 d ago');
  });

  it('writes the clock time with leading zeros in both languages', () => {
    const unix = new Date(2026, 8, 5, 7, 3, 9).getTime() / 1000;
    expect(f.time(unix)).toBe('07:03:09');
    expect(f.dateTime(unix)).toBe('2026-09-05 07:03:09');
    expect(withLocale('de').dateTime(unix)).toBe('05.09.2026 07:03:09');
  });

  it('writes small amounts and hash rates in their own units', () => {
    expect(f.magnitude(999)).toBe('999');
    expect(f.magnitude(1500)).toBe('1.5 k');
    expect(f.magnitude(2.5e6)).toBe('2.5 M');
    expect(f.magnitude(7e9)).toBe('7.0 G');
    expect(f.hashrate(4.2e9)).toBe('4.2 GH/s');
    expect(f.hashrate(1.5e12)).toBe('1.5 TH/s');
    expect(f.hashrate(250e15)).toBe('250 PH/s');
    expect(f.btc(0)).toBe('0.00 BTC');
  });

  it('writes percentages and fee rates', () => {
    expect(f.percent(0.1124)).toBe('11 %');
    expect(f.percent(0.1124, 2)).toBe('11.24 %');
    expect(f.satvb(2.75)).toBe('2.8 sat/vB');
    expect(f.satvb(3, 0)).toBe('3 sat/vB');
    expect(withLocale('de').percent(0.1124, 2)).toBe('11,24 %');
  });
});

/** Reads an English number back: commas are thousands separators. */
const parse = (s: string) => Number(s.replace(/,/g, ''));
const positive = fc.double({ min: 0, max: 1e24, noNaN: true });

describe('formatter invariants', () => {
  const en = withLocale('en');
  const de = withLocale('de');

  it('never throw, whatever number arrives', () => {
    const any = fc.oneof(fc.double(), fc.constantFrom(NaN, Infinity, -Infinity, -0));
    const unary = [
      'integer',
      'decimal',
      'bytes',
      'duration',
      'durationShort',
      'age',
      'date',
      'time',
      'dateTime',
      'btc',
      'magnitude',
      'hashrate',
      'latency',
      'percent',
      'satvb',
    ] as const;
    fc.assert(
      fc.property(any, (n) => {
        for (const name of unary) expect(typeof en[name](n)).toBe('string');
      }),
    );
  });

  it('German and English differ only in the swapped separators', () => {
    const swap = (s: string) => s.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'));
    fc.assert(
      fc.property(fc.double({ min: -1e15, max: 1e15, noNaN: true }), (n) => {
        expect(de.integer(n)).toBe(swap(en.integer(n)));
        expect(de.decimal(n, 2)).toBe(swap(en.decimal(n, 2)));
        expect(de.bytes(Math.abs(n))).toBe(swap(en.bytes(Math.abs(n))));
        expect(de.latency(Math.abs(n))).toBe(swap(en.latency(Math.abs(n))));
      }),
    );
  });

  it('bytes picks the largest unit below the value and reads back within rounding', () => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    fc.assert(
      fc.property(positive, (n) => {
        const m = /^([\d,]+\.\d) (B|KB|MB|GB|TB)$/.exec(en.bytes(n));
        expect(m).not.toBeNull();
        const value = parse(m![1]!);
        const scale = 1000 ** units.indexOf(m![2]!);
        if (m![2] !== 'TB') expect(value).toBeLessThanOrEqual(1000);
        if (m![2] !== 'B') expect(n).toBeGreaterThanOrEqual(scale);
        expect(Math.abs(value * scale - n)).toBeLessThanOrEqual(0.05 * scale * (1 + 1e-9));
      }),
    );
  });

  it('bytes never falls as the value rises', () => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const back = (s: string) => {
      const [v, u] = s.split(' ');
      return parse(v!) * 1000 ** units.indexOf(u!);
    };
    fc.assert(
      fc.property(positive, positive, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(back(en.bytes(lo))).toBeLessThanOrEqual(back(en.bytes(hi)));
      }),
    );
  });

  it('duration truncates to the shown unit and never falls as time passes', () => {
    const seconds = (s: string) => {
      let m = /^(\d+) d (\d+) h$/.exec(s);
      if (m) return Number(m[1]) * 86400 + Number(m[2]) * 3600;
      m = /^(\d+) h (\d+) min$/.exec(s);
      if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
      m = /^(\d+) min$/.exec(s);
      if (m) return Number(m[1]) * 60;
      throw new Error(`unexpected duration ${s}`);
    };
    const secs = fc.integer({ min: 0, max: 10 * 365 * 86400 });
    fc.assert(
      fc.property(secs, secs, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const shown = seconds(en.duration(lo));
        expect(shown).toBeLessThanOrEqual(lo);
        expect(lo - shown).toBeLessThan(lo >= 86400 ? 3600 : 60);
        expect(shown).toBeLessThanOrEqual(seconds(en.duration(hi)));
      }),
    );
  });

  it('latency switches from ms to s at one second and reads back within rounding', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e7, noNaN: true }), (ms) => {
        const [v, unit] = en.latency(ms).split(' ');
        if (ms < 1000) {
          expect(unit).toBe('ms');
          expect(Math.abs(parse(v!) - ms)).toBeLessThanOrEqual(0.5);
        } else {
          expect(unit).toBe('s');
          expect(Math.abs(parse(v!) * 1000 - ms)).toBeLessThanOrEqual(50 + 1e-6);
        }
      }),
    );
  });

  it('hashrate and magnitude read back within rounding', () => {
    const hash = { 'GH/s': 1e9, 'TH/s': 1e12, 'PH/s': 1e15, 'EH/s': 1e18 } as const;
    const mag = { '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12 } as const;
    fc.assert(
      fc.property(fc.double({ min: 1e9, max: 1e22, noNaN: true }), (n) => {
        const [v, unit] = en.hashrate(n).split(' ') as [string, keyof typeof hash];
        expect(Math.abs(parse(v) * hash[unit] - n) / n).toBeLessThan(0.05);
        const parts = en.magnitude(n).split(' ');
        const back = parse(parts[0]!) * mag[(parts[1] ?? '') as keyof typeof mag];
        expect(Math.abs(back - n) / n).toBeLessThan(0.05);
      }),
    );
  });

  it('date writes the same day in both notations', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800 }), (unix) => {
        const [y, m, d] = en.date(unix).split('-');
        expect(de.date(unix)).toBe(`${d}.${m}.${y}`);
        expect(en.dateTime(unix)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      }),
    );
  });
});

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Every number on the page goes through here. German writes 1.234.567,8,
 * English 1,234,567.8 — Intl knows both, and one forgotten bare
 * `toFixed()` is exactly how "11.24 %" once slipped onto the German page.
 */
export function useFormat() {
  const { t, locale } = useI18n();
  const tag = computed(() => (locale.value === 'de' ? 'de-DE' : 'en-GB'));

  const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag.value, opts);

  const integer = (n: number) => nf({ maximumFractionDigits: 0 }).format(Math.round(n));
  const decimal = (n: number, digits = 1) =>
    nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

  const bytes = (n: number) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
      v /= 1000;
      i++;
    }
    return `${decimal(v, 1)} ${units[i]}`;
  };

  const duration = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return t('time.dh', { d, h });
    if (h) return t('time.hm', { h, m });
    return t('time.m', { m });
  };

  /** Like `duration`, but seconds below a minute — for the peer box. */
  const durationShort = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return t('time.s', { s });
    return duration(s);
  };

  const age = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 90) return t('time.agoS', { n: s });
    if (s < 5400) return t('time.agoMin', { n: Math.floor(s / 60) });
    if (s < 172800) return t('time.agoH', { n: Math.floor(s / 3600) });
    return t('time.agoD', { n: Math.floor(s / 86400) });
  };

  /** 2026-09-07 or 07.09.2026 — the American form would be ambiguous below the 13th. */
  const date = (unix: number) => {
    const d = new Date(unix * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return locale.value === 'de' ? `${day}.${m}.${y}` : `${y}-${m}-${day}`;
  };

  const time = (unix: number) => {
    const d = new Date(unix * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  };

  const dateTime = (unix: number) => `${date(unix)} ${time(unix)}`;

  const btc = (sat: number) => {
    const v = sat / 1e8;
    return v >= 1000 ? `${integer(v)} BTC` : `${decimal(v, 2)} BTC`;
  };

  /** 126000000000000 → 126.0 T — prefixes are the same in both languages. */
  const magnitude = (n: number) => {
    for (const [limit, suffix] of [
      [1e12, 'T'],
      [1e9, 'G'],
      [1e6, 'M'],
      [1e3, 'k'],
    ] as const) {
      if (n >= limit) return `${decimal(n / limit, 1)} ${suffix}`;
    }
    return integer(n);
  };

  const hashrate = (hps: number) => {
    for (const [unit, size] of [
      ['EH/s', 1e18],
      ['PH/s', 1e15],
      ['TH/s', 1e12],
    ] as const) {
      if (hps >= size) {
        const v = hps / size;
        return `${v >= 100 ? integer(v) : decimal(v, 1)} ${unit}`;
      }
    }
    return `${decimal(hps / 1e9, 1)} GH/s`;
  };

  /** Milliseconds up to a second, seconds above — a minute-long ping during sync reads badly as ms. */
  const latency = (ms: number) => (ms < 1000 ? `${integer(ms)} ms` : `${decimal(ms / 1000, 1)} s`);

  const percent = (fraction: number, digits = 0) => `${decimal(fraction * 100, digits)} %`;

  const satvb = (v: number, digits = 1) => `${decimal(v, digits)} ${t('units.satvb')}`;

  return {
    integer,
    decimal,
    bytes,
    duration,
    durationShort,
    age,
    date,
    time,
    dateTime,
    btc,
    magnitude,
    hashrate,
    latency,
    percent,
    satvb,
  };
}

export type Formatter = ReturnType<typeof useFormat>;

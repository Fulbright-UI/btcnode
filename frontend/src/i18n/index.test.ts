import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALES, detectLocale, i18n } from './index';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('detectLocale', () => {
  it('follows ?lang= before anything else', () => {
    localStorage.setItem('btcnode.locale', 'en');
    expect(detectLocale('?lang=de', 'en-US')).toBe('de');
    expect(detectLocale('?x=1&lang=en', 'de-DE')).toBe('en');
  });

  it('ignores an unsupported ?lang= and uses the remembered choice', () => {
    localStorage.setItem('btcnode.locale', 'de');
    expect(detectLocale('?lang=fr', 'en-US')).toBe('de');
    expect(detectLocale('', 'en-US')).toBe('de');
  });

  it('ignores an unsupported remembered value and asks the browser', () => {
    localStorage.setItem('btcnode.locale', 'klingon');
    expect(detectLocale('', 'de-AT')).toBe('de');
    expect(detectLocale('', 'DE')).toBe('de');
    expect(detectLocale('', 'fr-FR')).toBe('en');
  });

  it('falls back to the browser when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(detectLocale('', 'de-CH')).toBe('de');
    expect(detectLocale('', 'en-GB')).toBe('en');
  });

  it('reads the page address and the browser language by default', () => {
    expect(['en', 'de']).toContain(detectLocale());
  });
});

describe('i18n instance', () => {
  it('offers both languages and falls back to English', () => {
    expect(LOCALES).toEqual(['en', 'de']);
    expect(i18n.global.availableLocales.sort()).toEqual(['de', 'en']);
    expect(i18n.global.fallbackLocale.value).toBe('en');
  });

  it('translates with the composition API', () => {
    i18n.global.locale.value = 'de';
    expect(i18n.global.t('network.local')).toBe('lokal');
    i18n.global.locale.value = 'en';
    expect(i18n.global.t('network.local')).toBe('local');
  });
});

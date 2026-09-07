import { createI18n } from 'vue-i18n';
import de from './locales/de.json';
import en from './locales/en.json';

export type Locale = 'en' | 'de';
export const LOCALES: Locale[] = ['en', 'de'];

function isLocale(v: unknown): v is Locale {
  return v === 'de' || v === 'en';
}

/** The page language: `?lang=de`, then the remembered choice, then the browser's, then English. */
export function detectLocale(
  search = window.location.search,
  navigatorLang = navigator.language,
): Locale {
  const wanted = new URLSearchParams(search).get('lang');
  if (isLocale(wanted)) return wanted;
  try {
    const stored = localStorage.getItem('btcnode.locale');
    if (isLocale(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return navigatorLang.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, de },
  // Numbers and dates are formatted by useFormat with Intl — not here.
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

export type MessageSchema = typeof en;

import { createPinia, setActivePinia } from 'pinia';
import type { Pinia } from 'pinia';
import type { Plugin } from 'vue';
import { vi } from 'vitest';
import { i18n } from '@/i18n';
import type { Locale } from '@/i18n';

/**
 * A fresh, active pinia for one test and the real i18n in the given locale.
 * Stores are then set directly: `useStatusStore().snapshot = snapshot()`.
 */
export function setup(locale: Locale = 'en'): { pinia: Pinia; global: { plugins: Plugin[] } } {
  const pinia = createPinia();
  setActivePinia(pinia);
  i18n.global.locale.value = locale;
  return { pinia, global: { plugins: [pinia, i18n] } };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Replaces fetch for the test; unknown paths answer 404 so nothing hits the network. */
export function stubFetch(handler: Handler = () => new Response('', { status: 404 })) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

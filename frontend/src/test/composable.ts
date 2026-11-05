import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';

/** Runs a composable inside a mounted component with the real locale files. */
export function withSetup<T>(composable: () => T, locale: 'en' | 'de' = 'en'): T {
  let result!: T;
  const Probe = defineComponent({
    setup() {
      result = composable();
      return () => h('div');
    },
  });
  mount(Probe, {
    global: { plugins: [createI18n({ legacy: false, locale, messages: { en, de } })] },
  });
  return result;
}

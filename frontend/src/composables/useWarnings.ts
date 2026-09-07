import type { Warning } from '@btcnode/shared';
import { useI18n } from 'vue-i18n';

/** Turn a warning code plus its numbers into the sentence the state bar shows. */
export function useWarnings() {
  const { t } = useI18n();
  const text = (w: Warning): string => t(`warnings.${w.code}`, w.params ?? {});
  return { text };
}

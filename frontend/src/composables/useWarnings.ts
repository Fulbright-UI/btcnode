import { networkKindSchema } from '@btcnode/shared';
import type { Warning } from '@btcnode/shared';
import { useI18n } from 'vue-i18n';
import { usePeerLabels } from '@/composables/usePeerLabels';

/** Turn a warning code plus its numbers into the sentence the state bar shows. */
export function useWarnings() {
  const { t } = useI18n();
  const labels = usePeerLabels();
  const text = (w: Warning): string => {
    const params = { ...w.params };
    // a network arrives as its kind ("onion") and is shown by its name ("Tor")
    const kind = networkKindSchema.safeParse(params.network);
    if (kind.success) params.network = labels.networkName(kind.data);
    return t(`warnings.${w.code}`, params);
  };
  return { text };
}

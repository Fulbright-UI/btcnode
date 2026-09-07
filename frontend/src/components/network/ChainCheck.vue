<script setup lang="ts">
import type { StatusSnapshot } from '@btcnode/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '@/composables/useFormat';

/**
 * One dot per chain-check sample of the last hour: green = same height,
 * grey = the stranger was behind, red = it claimed more. The sentence is
 * assembled from pieces so every sample is accounted for and the verb
 * agrees with the count.
 */
const props = defineProps<{ check: StatusSnapshot['chainCheck']; generatedAt: number }>();
const { t } = useI18n();
const format = useFormat();

const view = computed(() => {
  const c = props.check;
  if (!c.samples.length) {
    return c.unsupported
      ? {
          unsupported: true,
          dots: [],
          text: t('network.chainCheckUnsupported'),
          warn: false,
          title: '',
        }
      : null;
  }
  const last = format.age(props.generatedAt - c.samples[c.samples.length - 1]!.at);
  const ok = c.samples.filter((s) => s.verdict === 'same').length;
  const behind = c.samples.filter((s) => s.verdict === 'behind').length;
  const claimed = c.samples.length - ok - behind;
  let text: string;
  if (c.alarm) {
    text = t('network.chainCheckAlarm', { k: claimed, n: format.integer(c.ahead) });
  } else {
    text = t('network.chainCheckMatched', { ok, n: c.samples.length });
    if (behind) text += t('network.chainCheckBehind', { behind });
    if (c.ahead) {
      const claim =
        claimed === 1
          ? t('network.chainCheckOneClaimed')
          : t('network.chainCheckClaimed', { k: claimed });
      text += t('network.chainCheckClaimMore', { claim, b: format.integer(c.ahead) });
    } else {
      text += t('network.chainCheckNoneAhead');
    }
    text += t('network.chainCheckLast', { when: last });
  }
  return {
    unsupported: false,
    dots: c.samples.slice(-12).map((s) => s.verdict),
    text,
    warn: c.alarm,
    title: t('network.chainCheckTitle', { when: last }),
  };
});
</script>

<template>
  <span
    v-if="view"
    class="chain-check"
    :class="{ warn: view.warn }"
    :title="view.title || undefined"
  >
    <span v-if="view.dots.length" class="probes"
      ><i v-for="(d, i) in view.dots" :key="i" class="probe" :class="d"></i
    ></span>
    {{ view.text }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SkeletonChart from '@/components/charts/SkeletonChart.vue';
import { useFormat } from '@/composables/useFormat';

/** Sync progress over time — a handful of coordinates, no charting library. */
const props = defineProps<{ history: [number, number][] }>();
const { t } = useI18n();
const format = useFormat();
const W = 300;
const H = 54;
const margin = 3;

const curve = computed(() => {
  const h = props.history;
  if (h.length < 3) return null;
  const t0 = h[0]![0];
  const t1 = h[h.length - 1]![0];
  const values = h.map((p) => p[1]);
  const w0 = Math.min(...values);
  const w1 = Math.max(...values);
  if (t1 <= t0 || w1 <= w0) return null;
  const pts = h.map(([z, w]) => {
    const x = margin + ((z - t0) / (t1 - t0)) * (W - 2 * margin);
    const y = margin + (1 - (w - w0) / (w1 - w0)) * (H - 2 * margin);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  return {
    line,
    area: `${margin},${H - margin} ${line} ${W - margin},${H - margin}`,
    span: format.duration(t1 - t0),
    gain: format.decimal((w1 - w0) * 100, 2),
  };
});
</script>

<template>
  <div class="curve">
    <svg
      v-if="curve"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="t('state.historySpan', { span: curve.span, n: curve.gain })"
    >
      <polygon :points="curve.area" class="curve-area" fill="var(--bar)" opacity=".14" />
      <polyline
        :points="curve.line"
        fill="none"
        stroke="var(--bar)"
        stroke-width="1.6"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    <SkeletonChart v-else :label="t('state.historyMeasuring')" :width="W" :height="H" />
    <span class="curve-foot">{{
      curve ? t('state.historySpan', { span: curve.span, n: curve.gain }) : t('state.historyAfter')
    }}</span>
  </div>
</template>

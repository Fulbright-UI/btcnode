<script setup lang="ts">
import { THRESHOLDS } from '@btcnode/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ChartLegend from '@/components/charts/ChartLegend.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import type { Column } from '@/components/charts/ColumnChart.vue';
import SkeletonChart from '@/components/charts/SkeletonChart.vue';
import { useFormat } from '@/composables/useFormat';
import { tierOf } from '@/lib/columns';
import { useStatusStore } from '@/stores/status';

const { t } = useI18n();
const format = useFormat();
const status = useStatusStore();
const blocks = computed(() => status.snapshot?.blocks24h ?? []);

const figures = computed(() => {
  const b = blocks.value;
  if (b.length < 3) return null;
  const fees = b.map((e) => e.medianFee);
  const known = fees.filter((f) => f > 0);
  return {
    latest: fees[fees.length - 1]!,
    average: known.length ? known.reduce((a, c) => a + c, 0) / known.length : 0,
    min: known.length ? Math.min(...known) : 0,
    max: known.length ? Math.max(...known) : 0,
  };
});

/** Median fee per block, rounded to whole sat/vB and tinted by tier — a line chart hid how many blocks sat at the floor. */
const columns = computed<Column[]>(() =>
  blocks.value.map((e) => {
    const rounded = Math.max(0, Math.round(e.medianFee));
    return {
      value: rounded,
      colour: `col-tier-${tierOf(rounded, THRESHOLDS.feeTiers)}`,
      title: t('blocks.feeTitle', {
        n: format.integer(e.height),
        f: format.decimal(e.medianFee, 1),
      }),
    };
  }),
);

const legend = computed(() => [
  { colour: 'tier-1', text: t('blocks.upTo2') },
  { colour: 'tier-2', text: t('blocks.upTo5') },
  { colour: 'tier-3', text: t('blocks.above5') },
]);
</script>

<template>
  <section class="card">
    <h2>{{ t('cards.fees') }}</h2>
    <dl>
      <dt>{{ t('blocks.latest') }}</dt>
      <dd :class="{ faint: !figures }">{{ figures ? format.satvb(figures.latest) : '—' }}</dd>
      <dt>{{ t('blocks.average24') }}</dt>
      <dd :class="{ faint: !figures }">{{ figures ? format.satvb(figures.average) : '—' }}</dd>
      <dt>{{ t('blocks.range') }}</dt>
      <dd :class="{ faint: !figures }">
        {{
          figures
            ? t('blocks.rangeValue', {
                from: format.integer(figures.min),
                to: format.integer(figures.max),
              })
            : '—'
        }}
      </dd>
    </dl>
    <span class="chart-label">
      {{
        figures
          ? t('blocks.peak', { label: t('blocks.feePerBlock'), v: format.satvb(figures.max) })
          : t('blocks.feePerBlock')
      }}
    </span>
    <div class="chart-foot">
      <template v-if="figures">
        <ColumnChart :columns="columns" :label="t('blocks.feeAria')" />
        <ChartLegend :entries="legend" />
      </template>
      <SkeletonChart v-else :label="t('blocks.feePerBlock')" />
    </div>
    <p v-if="!figures" class="card-foot">{{ t('blocks.waiting') }}</p>
  </section>
</template>

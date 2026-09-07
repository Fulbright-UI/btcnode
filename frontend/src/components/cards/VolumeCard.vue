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
const ready = computed(() => blocks.value.length >= 3);

const figures = computed(() => {
  const b = blocks.value;
  if (!ready.value) return null;
  const outputs = b.map((e) => e.totalOut);
  const period = b[b.length - 1]!.time - b[0]!.time || 1;
  return {
    total: outputs.reduce((a, c) => a + c, 0),
    transactions: b.reduce((a, c) => a + c.txCount, 0),
    count: b.length,
    hours: Math.round(period / 3600),
    peak: Math.max(...outputs),
    mean: outputs.reduce((a, c) => a + c, 0) / outputs.length,
  };
});

/** One bar per block, tinted against the 24-hour mean — fixed BTC limits would make a whole day one colour. */
const columns = computed<Column[]>(() => {
  const f = figures.value;
  if (!f) return [];
  return blocks.value.map((e) => ({
    value: e.totalOut,
    colour: `col-tier-${tierOf(f.mean ? e.totalOut / f.mean : 0, THRESHOLDS.volumeTiers)}`,
    title: t('blocks.volumeTitle', {
      n: format.integer(e.height),
      v: format.btc(e.totalOut),
      k: format.integer(e.txCount),
    }),
  }));
});

const legend = computed(() => [
  { colour: 'tier-1', text: t('blocks.belowMean') },
  { colour: 'tier-2', text: t('blocks.upToTwice') },
  { colour: 'tier-3', text: t('blocks.aboveThat') },
]);
</script>

<template>
  <section class="card">
    <h2>{{ t('cards.volume') }}</h2>
    <dl>
      <dt>{{ t('blocks.total') }}</dt>
      <dd :class="{ faint: !figures }">{{ figures ? format.btc(figures.total) : '—' }}</dd>
      <dt>{{ t('blocks.transactions') }}</dt>
      <dd :class="{ faint: !figures }">
        {{ figures ? format.integer(figures.transactions) : '—' }}
      </dd>
      <dt>{{ t('blocks.blocks') }}</dt>
      <dd :class="{ faint: !figures }">
        {{ figures ? t('blocks.blocksHours', { n: figures.count, h: figures.hours }) : '—' }}
      </dd>
    </dl>
    <span class="chart-label">
      {{
        figures
          ? t('blocks.peak', { label: t('blocks.volumePerBlock'), v: format.btc(figures.peak) })
          : t('blocks.volumePerBlock')
      }}
    </span>
    <div class="chart-foot">
      <template v-if="figures">
        <ColumnChart :columns="columns" :label="t('blocks.volumeAria')" />
        <ChartLegend :entries="legend" />
      </template>
      <SkeletonChart v-else :label="t('blocks.volumePerBlock')" columns />
    </div>
    <p v-if="!figures" class="card-foot">{{ t('blocks.waiting') }}</p>
  </section>
</template>

<script setup lang="ts">
import { THRESHOLDS } from '@btcnode/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import type { Column } from '@/components/charts/ColumnChart.vue';
import FillBar from '@/components/charts/FillBar.vue';
import SkeletonChart from '@/components/charts/SkeletonChart.vue';
import { useFormat } from '@/composables/useFormat';
import { useStatusStore } from '@/stores/status';

const { t } = useI18n();
const format = useFormat();
const status = useStatusStore();
const sys = computed(() => status.snapshot?.system ?? null);

function temperatureColour(c: number): string {
  if (c >= THRESHOLDS.temperatureHigh) return 'col-error';
  if (c >= THRESHOLDS.temperatureWarn) return 'col-warn';
  return 'col-good';
}

/** One bar per hour, the hour's peak, 24 slots oldest first; hours not yet measured stay a low stub in the frame colour. */
const temperatureColumns = computed<Column[] | null>(() => {
  const hours = sys.value?.temperatureHourly ?? [];
  if (!hours.length) return null;
  const { floor, ceiling } = THRESHOLDS.temperatureScale;
  const stub = floor + (ceiling - floor) * 0.06;
  const cols: Column[] = hours.map((h) => ({
    value: h.peak,
    colour: temperatureColour(h.peak),
    title: t('system.peakTitle', {
      hour: String(new Date(h.hour * 1000).getHours()).padStart(2, '0'),
      c: format.decimal(h.peak, 1),
    }),
  }));
  while (cols.length < 24) cols.push({ value: stub, colour: 'col-stub' });
  return cols;
});

const memory = computed(() => {
  const m = sys.value?.memory;
  if (!m) return null;
  const fraction = m.used / m.total;
  return {
    fraction,
    text: t('system.ofTotal', { used: format.bytes(m.used), total: format.bytes(m.total) }),
    warn: fraction > THRESHOLDS.memoryWarn,
  };
});

const disk = computed(() => {
  const d = sys.value?.disk;
  if (!d) return null;
  const fraction = d.total ? d.used / d.total : 0;
  const level: '' | 'warn' | 'error' =
    fraction >= THRESHOLDS.diskCritical ? 'error' : fraction >= THRESHOLDS.diskWarn ? 'warn' : '';
  return {
    fraction,
    level,
    text: t('system.diskUsed', { pct: Math.round(fraction * 100), free: format.bytes(d.free) }),
  };
});

const power = computed(() => {
  const p = sys.value?.power;
  if (!p) return null;
  const notes: string[] = [];
  if (p.undervoltageNow) notes.push(t('system.undervoltageNow'));
  if (p.undervoltageSinceBoot) notes.push(t('system.undervoltageSinceBoot'));
  if (p.throttled) notes.push(t('system.throttled'));
  if (!notes.length) return { text: t('system.stable'), cls: 'good' };
  return { text: notes.join(', '), cls: 'warn' };
});
</script>

<template>
  <section class="card">
    <h2>{{ t('cards.system') }}</h2>
    <dl v-if="sys">
      <template v-if="sys.temperature !== null">
        <dt>{{ t('system.temperature') }}</dt>
        <dd :class="{ warn: sys.temperature >= THRESHOLDS.temperatureHigh }">
          {{ format.decimal(sys.temperature, 1) }} °C
        </dd>
        <dt class="chart-label">{{ t('system.peakPerHour') }}</dt>
        <dd class="chart">
          <ColumnChart
            v-if="temperatureColumns"
            :columns="temperatureColumns"
            :label="t('system.temperatureAria')"
            :floor="THRESHOLDS.temperatureScale.floor"
            :ceiling="THRESHOLDS.temperatureScale.ceiling"
          />
          <SkeletonChart v-else :label="t('system.temperatureMeasuring')" columns />
        </dd>
      </template>
      <template v-if="sys.cpuPercent !== null">
        <dt>{{ t('system.load') }}</dt>
        <dd :class="{ warn: sys.cpuPercent >= THRESHOLDS.cpuWarn }">
          {{ t('system.cpu', { n: Math.round(sys.cpuPercent) }) }}
        </dd>
        <dd class="chart">
          <FillBar
            :fraction="sys.cpuPercent / 100"
            :level="sys.cpuPercent >= THRESHOLDS.cpuWarn ? 'warn' : ''"
            :title="t('system.cpu', { n: Math.round(sys.cpuPercent) })"
          />
        </dd>
      </template>
      <template v-if="memory">
        <dt>{{ t('system.memory') }}</dt>
        <dd :class="{ warn: memory.warn }">{{ memory.text }}</dd>
        <dd class="chart">
          <FillBar
            :fraction="memory.fraction"
            :level="memory.warn ? 'warn' : ''"
            :title="memory.text"
          />
        </dd>
      </template>
      <template v-if="disk">
        <dt>{{ t('system.disk') }}</dt>
        <dd :class="{ warn: disk.level !== '' }">{{ disk.text }}</dd>
        <dd class="chart">
          <FillBar :fraction="disk.fraction" :level="disk.level" :title="disk.text" />
        </dd>
      </template>
      <template v-if="sys.uptime !== null">
        <dt>{{ t('system.uptime') }}</dt>
        <dd>{{ format.duration(sys.uptime) }}</dd>
      </template>
      <template v-if="power">
        <dt>{{ t('system.power') }}</dt>
        <dd :class="power.cls">{{ power.text }}</dd>
      </template>
    </dl>
  </section>
</template>

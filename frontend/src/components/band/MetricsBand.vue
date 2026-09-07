<script setup lang="ts">
import { BLOCK_INTERVAL_SECONDS, THRESHOLDS } from '@btcnode/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '@/composables/useFormat';
import { useStatusStore } from '@/stores/status';

/** Four numbers that always apply — the first thing the eye lands on. */
const { t } = useI18n();
const format = useFormat();
const status = useStatusStore();
const s = computed(() => status.snapshot);
const node = computed(() => s.value?.node ?? null);
const sync = computed(() => s.value?.state.level === 'sync');

const halvingDays = computed(() =>
  node.value
    ? Math.max(0, Math.round((node.value.halving.blocksLeft * BLOCK_INTERVAL_SECONDS) / 86400))
    : 0,
);

const fee = computed(() => {
  const n = node.value;
  if (!n) return null;
  const { economical, conservative, lastBlockMedian } = n.fees;
  if (economical !== null) {
    const safe =
      conservative !== null && conservative.toFixed(1) !== economical.toFixed(1)
        ? conservative
        : null;
    return { kind: 'estimate' as const, value: economical, safe };
  }
  if (lastBlockMedian !== null)
    return { kind: 'median' as const, value: lastBlockMedian, safe: null };
  return null;
});

const temperature = computed(() => s.value?.system.temperature ?? null);
const temperatureClass = computed(() => {
  const c = temperature.value;
  if (c === null) return '';
  return c >= THRESHOLDS.temperatureHigh ? 'warn' : c >= THRESHOLDS.temperatureWarn ? '' : 'good';
});
</script>

<template>
  <template v-if="node">
    <!-- First tile: the halving once the chain stands, the verified/known comparison during sync -->
    <div v-if="!sync" class="tile wide">
      <div class="tile-value">
        {{ format.integer(halvingDays) }}<span class="tile-of">{{ t('band.days') }}</span>
      </div>
      <div class="tile-label">
        {{ t('band.halving', { date: format.date(node.halving.estimatedAt) }) }}
      </div>
      <div class="tile-extra">
        {{ t('band.blocksToGo', { n: format.integer(node.halving.blocksLeft) }) }}
      </div>
    </div>
    <div v-else class="tile wide">
      <div class="tile-value">
        {{ format.integer(node.blocks) }}<span class="tile-of">{{ t('band.of') }}</span
        >{{ format.integer(node.headers) }}
      </div>
      <div class="tile-label">{{ t('band.verifiedKnown') }}</div>
      <div class="tile-extra">
        {{ t('band.onDisk', { n: format.bytes(node.sizeOnDisk) })
        }}{{ node.pruned ? t('band.pruning') : '' }}
      </div>
    </div>

    <div v-if="sync" class="tile">
      <div class="tile-value">{{ format.integer(Math.max(0, node.headers - node.blocks)) }}</div>
      <div class="tile-label">{{ t('band.blocksBehind') }}</div>
    </div>
    <div v-else-if="fee" class="tile good wide">
      <div class="tile-value">
        {{ format.decimal(fee.value, 1) }}<span class="tile-of">{{ t('units.satvb') }}</span>
      </div>
      <div class="tile-label">
        {{ fee.kind === 'estimate' ? t('band.feeNextBlock') : t('band.medianFee') }}
      </div>
      <div v-if="fee.safe !== null" class="tile-extra">
        {{ t('band.safe', { fee: format.decimal(fee.safe, 1) }) }}
      </div>
    </div>
    <div v-else class="tile">
      <div class="tile-value">{{ format.integer(node.mempool.txCount) }}</div>
      <div class="tile-label">{{ t('band.inMempool') }}</div>
    </div>

    <div class="tile" :class="node.connections.total < THRESHOLDS.connectionsMin ? 'warn' : 'good'">
      <div class="tile-value">{{ node.connections.total }}</div>
      <div class="tile-label">{{ t('band.connections') }}</div>
    </div>
  </template>
  <div v-if="temperature !== null" class="tile" :class="temperatureClass">
    <div class="tile-value">{{ format.decimal(temperature, 1) }} °C</div>
    <div class="tile-label">{{ t('band.temperature') }}</div>
  </div>
</template>

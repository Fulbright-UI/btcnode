<script setup lang="ts">
import { THRESHOLDS } from '@btcnode/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CopyField from '@/components/cards/CopyField.vue';
import FillBar from '@/components/charts/FillBar.vue';
import { useFormat } from '@/composables/useFormat';
import { useStatusStore } from '@/stores/status';

/**
 * One card with two inner columns — chain & mempool left, the Electrum
 * server right, the copy fields for the wallet underneath across the full
 * width. Three columns were tried and do not fit: the card is about 30 rem
 * wide on the Pi's screen.
 */
const { t } = useI18n();
const format = useFormat();
const status = useStatusStore();
const node = computed(() => status.snapshot?.node ?? null);
const electrum = computed(() => status.snapshot?.electrum ?? null);

const mempoolFill = computed(() => {
  const m = node.value?.mempool;
  if (!m || !m.maxUsage) return 0;
  return Math.min(1, m.usage / m.maxUsage);
});

const index = computed(() => {
  const e = electrum.value;
  const tip = node.value?.blocks ?? null;
  if (!e || !e.configured) return null;
  if (e.indexedHeight !== null && tip !== null) {
    const behind = Math.max(0, tip - e.indexedHeight);
    const fraction = tip ? Math.min(1, e.indexedHeight / tip) : 0;
    const heights = t('electrum.ofBlocks', {
      n: format.integer(e.indexedHeight),
      tip: format.integer(tip),
    });
    if (behind <= 1)
      return {
        text: t('electrum.complete'),
        cls: 'good',
        fraction: 1,
        level: '' as const,
        heights,
      };
    // Close to the tip a percentage says "100.0 %" while blocks are still missing — the count is the honest figure.
    const text =
      fraction >= 0.999
        ? t('electrum.blocksToGo', { n: format.integer(behind) })
        : format.percent(fraction, 1);
    return { text, cls: 'warn', fraction, level: 'warn' as const, heights };
  }
  if (e.running && e.knownByUnit)
    return {
      text: t('electrum.notReadable'),
      cls: 'faint',
      fraction: null,
      level: '' as const,
      heights: '',
    };
  if (e.running)
    return {
      text: t('electrum.ready'),
      cls: 'good',
      fraction: null,
      level: '' as const,
      heights: '',
    };
  return null;
});
</script>

<template>
  <section class="card">
    <h2>{{ node ? t('cards.networkElectrum') : t('cards.electrum') }}</h2>
    <div class="columns">
      <div v-if="node" class="column">
        <h3>{{ t('chain.column') }}</h3>
        <dl>
          <dt>{{ t('chain.difficulty') }}</dt>
          <dd>{{ format.magnitude(node.difficulty) }}</dd>
          <dt>{{ t('chain.nextAdjustment') }}</dt>
          <dd>{{ t('chain.inBlocks', { n: format.integer(node.retargetIn) }) }}</dd>
          <dt>{{ t('chain.memoryUse') }}</dt>
          <dd>
            {{
              node.mempool.maxUsage
                ? t('system.ofTotal', {
                    used: format.bytes(node.mempool.usage),
                    total: format.bytes(node.mempool.maxUsage),
                  })
                : format.bytes(node.mempool.usage)
            }}
          </dd>
          <dt>{{ t('chain.feesWaiting') }}</dt>
          <dd>{{ format.btc(node.mempool.totalFee) }}</dd>
          <dt class="chart-label">{{ t('chain.fillLevel') }}</dt>
          <dd class="chart">
            <FillBar
              :fraction="mempoolFill"
              :level="mempoolFill >= THRESHOLDS.mempoolFullWarn ? 'warn' : ''"
            />
          </dd>
        </dl>
      </div>
      <div v-if="electrum" class="column">
        <h3>{{ t('electrum.column') }}</h3>
        <dl v-if="!electrum.configured">
          <dt>{{ t('electrum.service') }}</dt>
          <dd class="faint">{{ t('electrum.noneSetUp') }}</dd>
          <dt>{{ t('electrum.wallet') }}</dt>
          <dd class="faint">{{ t('electrum.asksForeign') }}</dd>
        </dl>
        <dl v-else>
          <dt>{{ t('electrum.service') }}</dt>
          <dd :class="electrum.running ? 'good' : 'warn'">
            {{ electrum.running ? t('electrum.running') : t('electrum.stopped') }}
          </dd>
          <dt>{{ t('electrum.responding') }}</dt>
          <dd :class="electrum.reachable ? 'good' : 'warn'">
            {{ electrum.reachable ? t('electrum.yes') : t('electrum.noIndexing') }}
          </dd>
          <template v-if="index">
            <dt>{{ t('electrum.index') }}</dt>
            <dd :class="index.cls">{{ index.text }}</dd>
            <dd v-if="index.fraction !== null" class="chart">
              <FillBar :fraction="index.fraction" :level="index.level" :title="index.heights" />
            </dd>
          </template>
        </dl>
      </div>
    </div>
    <template v-if="electrum?.configured">
      <div v-if="electrum.lanAddress || electrum.onionAddress" class="copy-block">
        <CopyField
          v-if="electrum.lanAddress"
          :label="t('electrum.lan')"
          :value="electrum.lanAddress"
        />
        <CopyField
          v-if="electrum.onionAddress"
          :label="t('electrum.tor')"
          :value="electrum.onionAddress"
        />
      </div>
      <p class="card-foot">{{ t('electrum.walletNote') }}</p>
    </template>
    <p v-else-if="electrum" class="card-foot">
      {{ t('electrum.noneNote', { port: electrum.port }) }}
    </p>
  </section>
</template>

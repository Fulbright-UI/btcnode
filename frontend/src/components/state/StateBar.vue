<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import FillBar from '@/components/charts/FillBar.vue';
import HashrateCurve from '@/components/state/HashrateCurve.vue';
import ProgressCurve from '@/components/state/ProgressCurve.vue';
import { useFormat } from '@/composables/useFormat';
import { useNow } from '@/composables/useNow';
import { useWarnings } from '@/composables/useWarnings';
import { useStatusStore } from '@/stores/status';

const { t } = useI18n();
const format = useFormat();
const warnings = useWarnings();
const status = useStatusStore();
const now = useNow();

const s = computed(() => status.snapshot);
const node = computed(() => s.value?.node ?? null);
const level = computed(() => s.value?.state.level ?? 'starting');
const sync = computed(() => level.value === 'sync' && node.value !== null);

/** Seconds since the tip reached us — from the journal where known, else the miner's clock, never negative. */
const blockAge = computed(() => {
  const n = node.value;
  if (!n) return null;
  const at = n.tipArrivedAt ?? n.tipTime;
  return at === null ? null : Math.max(0, now.value - at);
});

const headline = computed(() => {
  const st = s.value?.state;
  if (!st) return { word: t('state.waiting'), extra: t('state.noAnswerYet') };
  switch (st.level) {
    case 'error':
      return { word: t('state.notReachable'), extra: t('state.notAnswering') };
    case 'starting':
      return st.warmupMessage
        ? { word: t('state.starting'), extra: st.warmupMessage }
        : { word: t('state.waiting'), extra: t('state.noAnswerYet') };
    case 'stale':
      return {
        word: t('state.slow'),
        extra: t('state.measuredAgo', { age: format.age(st.staleFor ?? 0) }),
      };
    case 'warn':
      return {
        word:
          st.warnings.length === 1
            ? t('state.oneNotice')
            : t('state.notices', { n: st.warnings.length }),
        extra: st.warnings[0] ? warnings.text(st.warnings[0]) : '',
      };
    default:
      return { word: t('state.allGood'), extra: t('state.nothingUnusual') };
  }
});

const syncSubline = computed(() => {
  const n = node.value;
  if (!n) return t('state.syncing');
  let line = t('state.syncing');
  // During the initial sync the tip is a block from years ago — "9 years ago" would mislead; the date says where the check stands.
  if (n.tipTime) line += ' · ' + t('state.verifiedThrough', { date: format.date(n.tipTime) });
  return line;
});

const hashrate = computed(() => {
  const h = s.value?.hashrate;
  // Not before the fill is complete: while the points come in from the tip
  // backwards, the axis rescales every pass and the curve seems to wander.
  if (!h || !h.complete || h.points.length < 3 || sync.value) return null;
  const last = h.points[h.points.length - 1]![1];
  const ago = h.points[Math.max(0, h.points.length - 1 - h.yearPeriods)]![1];
  return { rate: last, change: ago ? (last - ago) / ago : 0 };
});
</script>

<template>
  <section class="state-bar">
    <HashrateCurve v-if="hashrate && s" :points="s.hashrate.points" />
    <div class="state-left">
      <span class="status-dot"></span>
      <div v-if="sync && node">
        <div class="state-word">
          {{ format.decimal(node.verificationProgress * 100, 2) }}&nbsp;%
        </div>
        <div class="state-extra">{{ syncSubline }}</div>
      </div>
      <div v-else>
        <div class="state-word">{{ headline.word }}</div>
        <div class="state-extra">{{ headline.extra }}</div>
      </div>
    </div>
    <div class="state-right">
      <div class="state-number">{{ format.integer(node?.blocks ?? 0) }}</div>
      <div class="state-label">
        <template v-if="sync && node">{{
          t('state.ofBlocks', { n: format.integer(node.headers) })
        }}</template>
        <template v-else-if="blockAge !== null">{{
          t('state.blockAgo', { age: format.age(blockAge) })
        }}</template>
        <template v-else>{{ t('state.blockHeight') }}</template>
      </div>
      <div v-if="hashrate" class="hashrate-ticker">
        <b>{{ format.hashrate(hashrate.rate) }}</b>
        <span class="hashrate-delta" :class="hashrate.change >= 0 ? 'good' : 'warn'">
          {{ hashrate.change >= 0 ? '+' : '−'
          }}{{ format.decimal(Math.abs(hashrate.change) * 100, 1) }}&nbsp;%
        </span>
        <span class="hashrate-label">{{ t('state.hashrateLabel') }}</span>
      </div>
    </div>
    <div v-if="sync && node" class="progress-box">
      <FillBar :fraction="node.verificationProgress" :height="10" />
      <div class="progress-foot">
        <template v-if="node.sync.ratePerHour !== null && node.sync.remainingSeconds !== null">
          <span>{{ t('state.ratePerHour', { n: format.decimal(node.sync.ratePerHour, 2) }) }}</span>
          <span class="progress-remaining">{{
            t('state.remaining', { duration: format.duration(node.sync.remainingSeconds) })
          }}</span>
        </template>
        <template v-else>
          <span>{{ t('state.measuringRate') }}</span>
          <span class="progress-remaining"></span>
        </template>
      </div>
      <ProgressCurve :history="node.sync.history" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import AppHeader from '@/components/layout/AppHeader.vue';
import MetricsBand from '@/components/band/MetricsBand.vue';
import FeeCard from '@/components/cards/FeeCard.vue';
import NetworkElectrumCard from '@/components/cards/NetworkElectrumCard.vue';
import SystemCard from '@/components/cards/SystemCard.vue';
import VolumeCard from '@/components/cards/VolumeCard.vue';
import LogPanel from '@/components/log/LogPanel.vue';
import NetworkMapCard from '@/components/network/NetworkMapCard.vue';
import NoticeStack from '@/components/state/NoticeStack.vue';
import StateBar from '@/components/state/StateBar.vue';
import { useFormat } from '@/composables/useFormat';
import { LOCALES } from '@/i18n';
import type { Locale } from '@/i18n';
import { gridColumns } from '@/lib/grid';
import { useAuthStore } from '@/stores/auth';
import { useChronicleStore } from '@/stores/chronicle';
import { useLogStore } from '@/stores/log';
import { useStatusStore } from '@/stores/status';

const { t, locale } = useI18n();
const format = useFormat();
const status = useStatusStore();
const log = useLogStore();
const chronicle = useChronicleStore();
const auth = useAuthStore();

const snapshot = computed(() => status.snapshot);
const level = computed(() => snapshot.value?.state.level ?? 'starting');
const inSync = computed(() => snapshot.value?.node?.inSync ?? false);
const showCharts = computed(() => inSync.value);

onMounted(() => {
  status.start();
  log.start();
  void chronicle.load();
  void auth.load();
});
onBeforeUnmount(() => {
  status.stop();
  log.stop();
});

// The log clock follows the backend's configured interval once known.
watch(
  () => snapshot.value?.intervals.log,
  (seconds) => {
    if (seconds && seconds !== log.interval) log.start(seconds);
  },
);

watchEffect(() => {
  const root = document.documentElement;
  root.dataset.level = level.value;
  root.dataset.fresh = status.freshness;
  root.lang = locale.value;
  const s = snapshot.value;
  if (!s) return;
  document.title =
    level.value === 'sync' && s.node
      ? t('app.titleSync', {
          percent: format.decimal(s.node.verificationProgress * 100, 2),
          host: s.hostname,
        })
      : t('app.titleWord', { word: stateWord(), host: s.hostname });
});

function stateWord(): string {
  const s = snapshot.value;
  if (!s) return t('header.waitingForData');
  switch (s.state.level) {
    case 'error':
      return t('state.notReachable');
    case 'starting':
      return t('state.starting');
    case 'stale':
      return t('state.slow');
    case 'warn':
      return s.state.warnings.length === 1
        ? t('state.oneNotice')
        : t('state.notices', { n: s.state.warnings.length });
    default:
      return t('state.allGood');
  }
}

function switchLocale(next: Locale) {
  locale.value = next;
  try {
    localStorage.setItem('btcnode.locale', next);
  } catch {
    /* private mode */
  }
}
</script>

<template>
  <div class="shell">
    <AppHeader />
    <div class="content">
      <div class="row">
        <div class="left">
          <StateBar />
          <NoticeStack />
          <div class="band"><MetricsBand /></div>
          <div class="charts">
            <template v-if="showCharts">
              <VolumeCard />
              <FeeCard />
            </template>
          </div>
        </div>
        <div class="right">
          <div class="network-zone"><NetworkMapCard /></div>
        </div>
      </div>
      <div class="row">
        <div class="left">
          <div class="grid" :class="`cols-${gridColumns(2)}`">
            <SystemCard />
            <NetworkElectrumCard />
          </div>
        </div>
        <div class="right">
          <LogPanel />
        </div>
      </div>
    </div>
    <footer>
      <span v-if="snapshot">{{
        t('app.footer', { status: snapshot.intervals.status, log: snapshot.intervals.log })
      }}</span>
      <span v-if="snapshot">· v{{ snapshot.dashboardVersion }}</span>
      <span>
        <template v-for="(l, i) in LOCALES" :key="l">
          <span v-if="i > 0"> / </span>
          <button v-if="l !== locale" type="button" @click="switchLocale(l)">{{ l }}</button>
          <span v-else>{{ l }}</span>
        </template>
      </span>
    </footer>
  </div>
</template>

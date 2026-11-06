<script setup lang="ts">
import type { Peer } from '@btcnode/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ChainCheck from '@/components/network/ChainCheck.vue';
import NetworkMap from '@/components/network/NetworkMap.vue';
import PeerDetail from '@/components/network/PeerDetail.vue';
import { useFormat } from '@/composables/useFormat';
import { usePeerLabels } from '@/composables/usePeerLabels';
import { peerSummary } from '@/lib/peers';
import { useStatusStore } from '@/stores/status';

const { t } = useI18n();
const format = useFormat();
const labels = usePeerLabels();
const status = useStatusStore();

const hovered = ref<number | 'self' | null>(null);
const pinned = ref<number | null>(null);
const inside = ref(false);

/**
 * The map is not replaced while the mouse is inside it or a dot is pinned
 * — otherwise the dot vanishes from under the pointer and the box jumps
 * away while you are reading it. The frozen copy is released on leave.
 */
const frozen = ref<Peer[] | null>(null);
const livePeers = computed(() => status.snapshot?.peers.list ?? []);
const peers = computed(() => frozen.value ?? livePeers.value);
watch(livePeers, (next, prev) => {
  if ((inside.value || pinned.value !== null) && !frozen.value) frozen.value = prev;
});
function leave() {
  inside.value = false;
  hovered.value = null;
  if (pinned.value === null) frozen.value = null;
}
function pin(index: number) {
  pinned.value = pinned.value === index ? null : index;
  if (pinned.value === null && !inside.value) frozen.value = null;
}
const selected = computed<number | 'self' | null>(() => hovered.value ?? pinned.value);

const snapshot = computed(() => status.snapshot);
const summary = computed(() => peerSummary(peers.value));
const inSync = computed(() => snapshot.value?.node?.inSync ?? false);
const unavailable = computed(() => snapshot.value?.peers.unavailable ?? null);

const legend = computed(() => [
  { cls: 'electrs', text: t('network.electrumLegend') },
  { cls: 'onion', text: t('network.torLegend') },
  { cls: 'ipv4', text: 'IPv4' },
  { cls: 'ipv6', text: 'IPv6' },
  { cls: 'i2p', text: 'I2P' },
  { cls: 'announcer', text: t('network.announcerLegend') },
  { cls: 'direction filled', text: t('network.outbound') },
  { cls: 'direction', text: t('network.inbound') },
]);
</script>

<template>
  <section class="card network">
    <div class="card-head">
      <h2>{{ t('cards.connectedNodes') }}</h2>
      <div v-if="peers.length" class="network-figures">
        <span
          ><b>{{ summary.total }}</b> {{ t('network.connected') }}</span
        >
        <span
          ><b>{{ summary.inbound }}</b> {{ t('network.inbound') }}</span
        >
        <span v-for="[kind, n] in summary.byNetwork" :key="kind"
          ><b>{{ n }}</b> {{ labels.networkName(kind) }}</span
        >
        <span v-if="summary.averageLatency !== null"
          ><b>{{ format.latency(summary.averageLatency) }}</b>
          {{ t('network.averageRoundTrip') }}</span
        >
        <span v-if="summary.fastest !== null"
          ><b>{{ format.latency(summary.fastest) }}</b> {{ t('network.fastest') }}</span
        >
        <span v-for="l in summary.latency" :key="l.network" :class="{ warn: l.slow }">
          <b>{{ format.latency(l.medianMs) }}</b>
          {{ t('network.pingMedian', { network: labels.networkName(l.network) }) }}
        </span>
        <ChainCheck
          v-if="snapshot && inSync"
          :check="snapshot.chainCheck"
          :generated-at="snapshot.generatedAt"
        />
      </div>
      <span v-else-if="snapshot?.node" class="hint">{{
        unavailable === 'denied' ? t('network.deniedShort') : t('network.queryingPeers')
      }}</span>
    </div>

    <template v-if="peers.length && snapshot">
      <div class="network-map-box" @mouseenter="inside = true" @mouseleave="leave">
        <NetworkMap :peers="peers" :pinned="pinned" @hover="hovered = $event" @pin="pin" />
      </div>
      <div class="legend">
        <span v-for="e in legend" :key="e.cls"
          ><i class="swatch" :class="e.cls"></i>{{ e.text }}</span
        >
      </div>
      <PeerDetail
        :snapshot="{ ...snapshot, peers: { ...snapshot.peers, list: peers } }"
        :selected="selected"
      />
    </template>
    <template v-else-if="snapshot?.node">
      <!-- While getpeerinfo is not allowed or did not answer, the connection figures still have a home. -->
      <dl class="network-fallback">
        <dt>{{ t('network.fallbackConnections') }}</dt>
        <dd>{{ snapshot.node.connections.total }}</dd>
        <dt>{{ t('network.inbound') }}</dt>
        <dd>{{ snapshot.node.connections.inbound }}</dd>
        <dt>{{ t('network.outbound') }}</dt>
        <dd>{{ snapshot.node.connections.outbound }}</dd>
        <dt>{{ t('network.fallbackVersion') }}</dt>
        <dd>{{ snapshot.node.userAgent }}</dd>
        <dt>{{ t('network.nodeUpFor') }}</dt>
        <dd>{{ format.duration(snapshot.node.uptime) }}</dd>
      </dl>
      <i18n-t
        v-if="unavailable === 'denied'"
        keypath="network.deniedNote"
        tag="p"
        class="card-foot"
      >
        <template #method><code>getpeerinfo</code></template>
      </i18n-t>
      <p v-else class="card-foot">{{ t('network.queryingNote') }}</p>
    </template>
  </section>
</template>

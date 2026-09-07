<script setup lang="ts">
import type { Peer, StatusSnapshot } from '@btcnode/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '@/composables/useFormat';
import { usePeerLabels } from '@/composables/usePeerLabels';
import { shortenAddress } from '@/lib/networkMap';

/**
 * The box under the map. Resting: the sentence about the last block and the
 * announcer ranking. Pointing at a peer: what does not fit on its line.
 * Pointing at the hub: this node as its peers see it.
 */
const props = defineProps<{ snapshot: StatusSnapshot; selected: number | 'self' | null }>();
const { t } = useI18n();
const format = useFormat();
const labels = usePeerLabels();

const peer = computed<Peer | null>(() =>
  typeof props.selected === 'number' ? (props.snapshot.peers.list[props.selected] ?? null) : null,
);

function peerName(peerId: number, address: string | undefined, beforeRestart: boolean): string {
  if (!beforeRestart && address) return shortenAddress(address);
  return t('network.peerN', { n: peerId });
}

const blockSentence = computed(() => {
  const s = props.snapshot;
  const a = s.tipAnnouncement;
  if (!s.peers.list.length || !a) return '';
  let name = peerName(a.peerId, a.address, a.beforeRestart);
  // Not drawn is not the same as not connected: the map shows at most peersMax rows.
  if (!a.beforeRestart && !a.connected) name += ' ' + t('network.noLongerConnected');
  return t('network.blockAnnounced', {
    n: format.integer(a.height),
    when: format.age(s.generatedAt - a.at),
    peer: name,
  });
});

const rankingSentence = computed(() => {
  const s = props.snapshot;
  const r = s.announcerRanking;
  if (!r.length || !s.peers.list.length) return '';
  const parts = r
    .map((e) => `${peerName(e.peerId, e.address, e.beforeRestart)} × ${e.count}`)
    .join(' · ');
  let text = t('network.ranking', { total: s.announcedTotal, parts });
  const numbered = r.filter((e) => e.beforeRestart || !e.address);
  if (numbered.length) {
    text +=
      ' · ' +
      (numbered.every((e) => e.beforeRestart)
        ? t('network.numberedBeforeRestart')
        : t('network.numberedGone'));
  }
  return text;
});

/** Blocks in one direction with the time, relative to when the snapshot was taken. */
function blockCount(count: number, at: number | null): string {
  if (!at) return '—';
  return (
    (count ? `${count} · ` : '') +
    t('network.last', { when: format.age(props.snapshot.generatedAt - at) })
  );
}
</script>

<template>
  <div class="peer-detail">
    <template v-if="selected === 'self' && snapshot.node">
      <div class="peer-head">
        <i class="swatch announcer"></i>
        <span
          >{{ t('network.thisNode') }} · {{ snapshot.node.connections.inbound }}
          {{ t('network.inbound') }} · {{ snapshot.node.connections.outbound }}
          {{ t('network.outbound') }}</span
        >
      </div>
      <div class="peer-address">
        {{
          snapshot.node.self.localAddresses.length
            ? snapshot.node.self.localAddresses.join('  ')
            : t('network.noAddress')
        }}
      </div>
      <dl>
        <dt>{{ t('network.identifier') }}</dt>
        <dd>{{ snapshot.node.userAgent }}</dd>
        <dt>{{ t('network.protocol') }}</dt>
        <dd>{{ snapshot.node.protocolVersion }}</dd>
        <dt>{{ t('network.services') }}</dt>
        <dd>{{ snapshot.node.self.services.join(', ') || t('network.none') }}</dd>
        <dt>{{ t('network.nodeUpFor') }}</dt>
        <dd>{{ format.durationShort(snapshot.node.uptime) }}</dd>
        <dt>{{ t('network.relayFee') }}</dt>
        <dd>{{ format.satvb(snapshot.node.self.relayFee, 2) }}</dd>
      </dl>
    </template>
    <template v-else-if="peer">
      <div class="peer-head">
        <i class="swatch" :class="peer.network"></i>
        <span
          >{{ labels.networkName(peer.network) }} ·
          {{ peer.inbound ? t('network.inbound') : t('network.outbound') }}</span
        >
      </div>
      <div class="peer-address">{{ peer.address }}</div>
      <dl>
        <dt>{{ t('network.identifier') }}</dt>
        <dd>{{ peer.userAgent || t('network.unknown') }}</dd>
        <dt>{{ t('network.services') }}</dt>
        <dd>{{ peer.services.join(', ') || t('network.none') }}</dd>
        <dt>{{ t('network.connectedFor') }}</dt>
        <dd>{{ format.durationShort(peer.connectedFor) }}</dd>
        <template v-if="peer.currentPingMs !== null">
          <dt>{{ t('network.responseNow') }}</dt>
          <dd>{{ format.latency(peer.currentPingMs) }}</dd>
        </template>
        <dt>{{ t('network.received') }}</dt>
        <dd>{{ format.bytes(peer.bytesReceived) }}</dd>
        <dt>{{ t('network.sent') }}</dt>
        <dd>{{ format.bytes(peer.bytesSent) }}</dd>
        <dt>{{ t('network.addressesFrom') }}</dt>
        <dd>
          {{ format.integer(peer.addressesFrom)
          }}<template v-if="peer.addressesDropped">
            ·
            {{
              t('network.addressesDropped', { n: format.integer(peer.addressesDropped) })
            }}</template
          >
        </dd>
        <dt>{{ t('network.blocksFrom') }}</dt>
        <dd>{{ blockCount(peer.blocksFrom, peer.lastBlockFromAt) }}</dd>
        <dt>{{ t('network.blocksTo') }}</dt>
        <dd>{{ blockCount(peer.blocksTo, peer.lastBlockToAt) }}</dd>
      </dl>
    </template>
    <template v-else>
      <p class="block-path">{{ blockSentence }}</p>
      <p class="block-path">{{ rankingSentence }}</p>
      <p class="hint">{{ t('network.hint') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Peer } from '@btcnode/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePeerLabels } from '@/composables/usePeerLabels';
import { MAP, layoutNetworkMap } from '@/lib/networkMap';

/**
 * A fan: our own node in the middle, the peers to the left and right. No
 * world map — getpeerinfo carries no geodata and the backend never goes
 * online to look any up. The key figures sit right on the line so they can
 * be read without pointing; pointing highlights the row and shows the
 * longer details in the box below. Foreign text is rendered as text nodes
 * only — Vue never parses it as markup.
 */
const props = defineProps<{ peers: Peer[]; pinned: number | null }>();
const emit = defineEmits<{ hover: [index: number | 'self' | null]; pin: [index: number] }>();
const { t } = useI18n();
const labels = usePeerLabels();

const geometry = computed(() => layoutNetworkMap(props.peers, labels.peerLine));
const R = MAP.logoRadius;
</script>

<template>
  <svg
    v-if="geometry"
    class="network-map"
    :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
    role="img"
    :aria-label="t('network.mapAria', { n: peers.length })"
    @mouseleave="emit('hover', null)"
  >
    <g class="hub" tabindex="0" @mouseenter="emit('hover', 'self')" @focus="emit('hover', 'self')">
      <circle
        :cx="geometry.hub.x.toFixed(1)"
        :cy="geometry.hub.y.toFixed(1)"
        :r="R + 8"
        class="hub-hit"
      />
      <image
        href="/bitcoin.png"
        :x="(geometry.hub.x - R).toFixed(1)"
        :y="(geometry.hub.y - R).toFixed(1)"
        :width="R * 2"
        :height="R * 2"
      />
      <text
        :x="geometry.hub.x.toFixed(1)"
        :y="(geometry.hub.y + R + 26).toFixed(1)"
        class="hub-label"
        text-anchor="middle"
      >
        {{ t('network.thisNode') }}
      </text>
    </g>
    <g
      v-for="row in geometry.rows"
      :key="row.peer.id"
      class="peer"
      :class="[
        row.peer.network,
        { announcer: row.peer.announcedTip, active: pinned === row.index },
      ]"
      tabindex="0"
      @mouseenter="emit('hover', row.index)"
      @focus="emit('hover', row.index)"
      @click="emit('pin', row.index)"
    >
      <rect
        :x="(Math.min(row.xInner, row.xOuter) - 6).toFixed(1)"
        :y="(row.y - 15).toFixed(1)"
        :width="(Math.abs(row.xOuter - row.xInner) + 12).toFixed(1)"
        :height="MAP.rowHeight"
        class="peer-hit"
      />
      <line
        :x1="row.hubX.toFixed(1)"
        :y1="geometry.hub.y.toFixed(1)"
        :x2="row.xInner.toFixed(1)"
        :y2="row.y.toFixed(1)"
        class="peer-line"
      />
      <!-- Filled = outbound, ring = inbound: the word is on the line, the eye needs it on the dot. -->
      <circle
        :cx="row.xInner.toFixed(1)"
        :cy="row.y.toFixed(1)"
        :r="MAP.dotRadius"
        class="peer-dot"
        :class="{ filled: !row.peer.inbound }"
      />
      <text
        :x="row.xText.toFixed(1)"
        :y="row.y.toFixed(1)"
        :text-anchor="row.anchor"
        dominant-baseline="central"
        class="peer-label"
      >
        {{ row.label }}
      </text>
    </g>
  </svg>
</template>

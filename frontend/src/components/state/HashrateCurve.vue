<script setup lang="ts">
import { computed } from 'vue';
import { curvePoints } from '@/lib/columns';

/**
 * The curve behind the state bar, drawn like a price chart. Linear scale
 * across fourteen orders of magnitude: a flat line with the climb at the
 * right — which is what the hashrate actually did.
 */
const props = defineProps<{ points: [number, number][] }>();
const W = 600;
const H = 120;
const line = computed(() =>
  curvePoints(
    props.points.map((p) => p[1]).filter((v) => v > 0),
    W,
    H,
    0.15,
    0.05,
  ),
);
const area = computed(() => `0,${H} ${line.value} ${W},${H}`);
</script>

<template>
  <svg
    v-if="line"
    class="hashrate-curve"
    :viewBox="`0 0 ${W} ${H}`"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="hashrate-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="hashrate-stop-0"></stop>
        <stop offset="1" class="hashrate-stop-1"></stop>
      </linearGradient>
    </defs>
    <polygon :points="area" fill="url(#hashrate-gradient)" />
    <polyline
      :points="line"
      fill="none"
      stroke-width="1.5"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

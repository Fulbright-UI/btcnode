<script setup lang="ts">
import { computed } from 'vue';

/**
 * A horizontal fill bar. SVG on purpose instead of a div with an inline
 * width: the Content Security Policy forbids style attributes, and a width
 * as inline style would be dropped — the bar then always shows full. The
 * rounded corners come from CSS on the wrapper, never from `rx` on the
 * rectangle: preserveAspectRatio="none" would stretch it into a blob.
 */
const props = withDefaults(
  defineProps<{
    fraction: number;
    level?: '' | 'warn' | 'error';
    height?: 6 | 8 | 10;
    title?: string;
  }>(),
  { level: '', height: 6, title: '' },
);

const width = computed(() => Math.min(100, Math.max(0, props.fraction * 100)));
const tip = computed(() => props.title || `${Math.round(width.value)} %`);
</script>

<template>
  <span class="bar" :class="`h${height}`">
    <svg :viewBox="`0 0 100 ${height}`" preserveAspectRatio="none" role="img" :aria-label="tip">
      <rect :width="width.toFixed(2)" :height="height" class="bar-fill" :class="level">
        <title>{{ tip }}</title>
      </rect>
    </svg>
  </span>
</template>

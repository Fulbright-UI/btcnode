<script setup lang="ts">
import { computed } from 'vue';
import { COLUMN_CHART, layoutColumns } from '@/lib/columns';

export interface Column {
  value: number;
  /** CSS class carrying the fill colour (col-tier-1, col-good, …) */
  colour: string;
  title?: string;
}

/** Small column chart; every bar carries its value as a tooltip — there is no axis, and a bar without a number is a shape. */
const props = defineProps<{
  columns: Column[];
  label: string;
  floor?: number;
  ceiling?: number;
}>();

const rects = computed(() =>
  layoutColumns(
    props.columns.map((c) => c.value),
    {
      ...(props.floor !== undefined ? { floor: props.floor } : {}),
      ...(props.ceiling !== undefined ? { ceiling: props.ceiling } : {}),
    },
  ),
);
</script>

<template>
  <svg
    class="mini-chart columns-chart"
    :viewBox="`0 0 ${COLUMN_CHART.width} ${COLUMN_CHART.height}`"
    preserveAspectRatio="none"
    role="img"
    :aria-label="label"
  >
    <rect
      v-for="(r, i) in rects"
      :key="i"
      :x="r.x.toFixed(2)"
      :y="r.y.toFixed(2)"
      :width="r.width.toFixed(2)"
      :height="r.height.toFixed(2)"
      :class="columns[i]?.colour"
    >
      <title v-if="columns[i]?.title">{{ columns[i]?.title }}</title>
    </rect>
  </svg>
</template>

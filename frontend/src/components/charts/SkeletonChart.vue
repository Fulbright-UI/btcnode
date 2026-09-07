<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { COLUMN_CHART, skeletonColumns } from '@/lib/columns';

/**
 * A visibly empty skeleton where a graph will later appear. Explicitly NO
 * invented sample data: on a display that reports the state of a node an
 * invented curve is dangerous — on the next screenshot nobody can tell what
 * was measured and what was drawn.
 */
const props = withDefaults(
  defineProps<{ label?: string; columns?: boolean; width?: number; height?: number }>(),
  {
    label: '',
    columns: false,
    width: COLUMN_CHART.width,
    height: COLUMN_CHART.height,
  },
);
const { t } = useI18n();
const rects = computed(() => (props.columns ? skeletonColumns(props.width, props.height) : []));
const margin = 1.5;
</script>

<template>
  <svg
    class="mini-chart skeleton"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    role="img"
    :aria-label="label || t('app.noData')"
  >
    <template v-if="columns">
      <rect
        v-for="(r, i) in rects"
        :key="i"
        :x="r.x.toFixed(2)"
        :y="r.y.toFixed(1)"
        :width="r.width.toFixed(2)"
        :height="r.height.toFixed(1)"
        class="skeleton-part"
      />
    </template>
    <line
      v-else
      :x1="margin"
      :y1="(height / 2).toFixed(1)"
      :x2="width - margin"
      :y2="(height / 2).toFixed(1)"
      class="skeleton-line"
    />
  </svg>
</template>

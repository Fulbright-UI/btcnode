<script setup lang="ts">
/** The colour dots under a chart — the same markup as the network legend. */
defineProps<{ entries: { colour: string; text: string }[] }>();
</script>

<template>
  <span class="legend chart-legend">
    <span v-for="e in entries" :key="e.colour + e.text"
      ><i class="swatch" :class="e.colour"></i>{{ e.text }}</span
    >
  </span>
</template>

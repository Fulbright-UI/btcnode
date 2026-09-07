import type { Chronicle, ChronicleEntry } from '@btcnode/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';

/**
 * The chronicle advances on the backend's clock: entry number
 * floor((now − start) / interval). A page reload therefore lands on the
 * entry the animation would be at, and every restart of the backend begins
 * the story at the top.
 */
export const useChronicleStore = defineStore('chronicle', () => {
  const data = ref<Chronicle | null>(null);

  async function load() {
    try {
      data.value = await api.chronicle();
    } catch {
      data.value = null;
    }
  }

  function entryAt(nowSeconds: number): { index: number; entry: ChronicleEntry } | null {
    const c = data.value;
    if (!c || !c.entries.length) return null;
    const n = Math.max(0, Math.floor((nowSeconds - c.start) / c.interval));
    return { index: n, entry: c.entries[n % c.entries.length]! };
  }

  const interval = computed(() => data.value?.interval ?? 21);
  return { data, interval, load, entryAt };
});

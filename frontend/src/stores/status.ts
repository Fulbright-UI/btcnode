import type { StatusSnapshot } from '@btcnode/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';

const DEFAULT_INTERVAL = 21;

/**
 * Polls /api/status. The interval comes from the snapshot itself, so the
 * page follows the backend's clock. "fresh" means the last fetch succeeded;
 * a failed fetch keeps the old snapshot and marks it stale.
 */
export const useStatusStore = defineStore('status', () => {
  const snapshot = ref<StatusSnapshot | null>(null);
  const fetchedAt = ref<number | null>(null);
  const failed = ref(false);
  const backendDown = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const interval = computed(() => snapshot.value?.intervals.status ?? DEFAULT_INTERVAL);
  const freshness = computed<'none' | 'fresh' | 'stale'>(() => {
    if (!snapshot.value) return 'none';
    return failed.value ? 'stale' : 'fresh';
  });

  async function refresh(): Promise<void> {
    try {
      snapshot.value = await api.status();
      fetchedAt.value = Date.now() / 1000;
      failed.value = false;
      backendDown.value = false;
    } catch (err) {
      failed.value = true;
      // 503 is the backend before its first pass — not "down"
      backendDown.value = !(
        err instanceof Error &&
        'status' in err &&
        (err as { status: number }).status === 503
      );
    }
  }

  function schedule(gen: number) {
    if (gen !== generation) return;
    timer = setTimeout(async () => {
      await refresh();
      schedule(gen);
    }, interval.value * 1000);
  }

  function start() {
    stop();
    const gen = ++generation;
    void refresh().then(() => schedule(gen));
  }

  function stop() {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { snapshot, fetchedAt, failed, backendDown, interval, freshness, refresh, start, stop };
});

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';

const DEFAULT_INTERVAL = 3;

export const useLogStore = defineStore('log', () => {
  const text = ref('');
  const interval = ref(DEFAULT_INTERVAL);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const t = await api.log();
      if (t !== text.value) text.value = t;
    } catch {
      /* keep the last text; the status store reports the outage */
    }
  }

  function start(seconds = DEFAULT_INTERVAL) {
    stop();
    interval.value = seconds;
    void refresh();
    timer = setInterval(() => void refresh(), seconds * 1000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { text, interval, refresh, start, stop };
});

import { onScopeDispose, ref } from 'vue';

/** A shared clock in unix seconds, ticking once a second — for "x ago" labels and the header time. */
const now = ref(Date.now() / 1000);
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

export function useNow() {
  subscribers++;
  if (!timer) timer = setInterval(() => (now.value = Date.now() / 1000), 1000);
  onScopeDispose(() => {
    subscribers--;
    if (subscribers === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  });
  return now;
}

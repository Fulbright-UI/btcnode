<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChronicleStore } from '@/stores/chronicle';
import { useStatusStore } from '@/stores/status';

/**
 * A sentence from the history of money, typed into the header like a
 * person types. Built as a reconciler, not a sequence: the data cycle only
 * sets the TARGET; one loop compares what stands in the line with the
 * target — a prefix of the target types the next character, anything else
 * deletes the last one, all the way down, then breathes 1.4 s with the
 * cursor alone. Whatever the timing of fetches, restarts or tab switches,
 * the loop deletes exactly what is visible and types exactly the target.
 */
const { locale } = useI18n();
const chronicle = useChronicleStore();
const status = useStatusStore();

const parts = ref<[string, string, string]>(['', '', '']);
const target = ref<[string, string, string] | null>(null);
const typing = ref(false);
const deleting = ref(false);
/** Which of the three fields the cursor sits behind */
const cursorAt = ref(2);
let timer: ReturnType<typeof setTimeout> | null = null;
let lastIndex = -1;

const takt = computed(() => chronicle.interval * 1000);

function formatDate(iso: string): string {
  if (locale.value !== 'de') return iso;
  return iso.split('-').reverse().join('.');
}

function setTarget(fromReload: boolean) {
  const found = chronicle.entryAt(Date.now() / 1000);
  if (!found) return;
  // The fetches are not aligned to the takt windows; the same number can
  // come twice near a window's edge — same number, nothing to do.
  if (found.index === lastIndex) return;
  lastIndex = found.index;
  const e = found.entry;
  target.value = [`[${formatDate(e.date)}] `, e.who, ` ${e.text}`];
  if (fromReload) {
    // The page lands on the entry the animation would be at: typed, no deleting.
    parts.value = [...target.value];
    cursorAt.value = 2;
  }
  run();
}

function run() {
  if (timer) clearTimeout(timer);
  timer = null;
  const goal = target.value;
  if (!goal) return;
  const want = goal.join('');
  const have = parts.value.join('');
  if (document.hidden) {
    // Browsers throttle timers in hidden tabs to seconds; an animation nobody watches would still be running on return.
    parts.value = [...goal];
    cursorAt.value = 2;
    typing.value = false;
    return;
  }
  if (have === want) {
    typing.value = false;
    deleting.value = false;
    return;
  }
  const step = Math.max(14, Math.min(48, Math.floor((takt.value * 0.6) / (want.length || 1))));
  const erase = Math.max(4, Math.min(16, Math.floor((takt.value * 0.1) / (have.length || 1))));
  let pause: number;
  if (!want.startsWith(have) || (deleting.value && have !== '')) {
    // Not on the way to the target, or already deleting: all the way down —
    // "[" is a prefix of every entry and the line would restart from the bracket.
    let field = 2;
    while (field > 0 && !parts.value[field]) field--;
    typing.value = true;
    cursorAt.value = field;
    const next: [string, string, string] = [...parts.value];
    next[field] = next[field]!.slice(0, -1);
    parts.value = next;
    deleting.value = true;
    pause = erase;
  } else if (have === '' && deleting.value) {
    deleting.value = false;
    typing.value = false;
    pause = 1400;
  } else {
    // The next character, into the field it belongs to.
    let pos = have.length;
    let field = 0;
    while (field < 2 && pos >= goal[field]!.length) {
      pos -= goal[field]!.length;
      field++;
    }
    const ch = want.charAt(have.length);
    typing.value = true;
    cursorAt.value = field;
    const next: [string, string, string] = [...parts.value];
    next[field] = next[field]! + ch;
    parts.value = next;
    // Rhythm of a hand, not a ticker: a breath at every space, longer at punctuation.
    pause = step * (0.6 + Math.random() * 0.5);
    if (ch === ' ') pause = step * (1.8 + Math.random());
    if ('.,;:—'.includes(ch)) pause = step * 6;
  }
  timer = setTimeout(run, pause);
}

const onVisible = () => {
  if (!document.hidden) run();
};

onMounted(() => document.addEventListener('visibilitychange', onVisible));
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible);
  if (timer) clearTimeout(timer);
});

// First load: land on the current entry. Every later data cycle: advance.
watch(
  () => chronicle.data,
  (d) => {
    if (d) setTarget(true);
  },
);
watch(
  () => status.fetchedAt,
  () => {
    if (chronicle.data && lastIndex >= 0) setTarget(false);
  },
);
</script>

<template>
  <div class="term quote" :class="{ typing }">
    <span class="typed">
      <span class="part-date">{{ parts[0] }}</span
      ><span v-if="cursorAt === 0" class="cursor"></span>
      <span class="part-who">{{ parts[1] }}</span
      ><span v-if="cursorAt === 1" class="cursor"></span>
      <span class="part-text">{{ parts[2] }}</span
      ><span v-if="cursorAt === 2" class="cursor"></span>
    </span>
  </div>
</template>

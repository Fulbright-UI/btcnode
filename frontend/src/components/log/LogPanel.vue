<script setup lang="ts">
import { LOG_HIGHLIGHT, classifyLogLine } from '@btcnode/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLogStore } from '@/stores/log';

/**
 * The raw journal, newest first. Each line becomes a span classed by the
 * shared pattern table; the text is rendered as text nodes only — Bitcoin
 * Core logs the self-chosen identifiers of foreign nodes, and nothing in a
 * line may ever become markup.
 */
const { t } = useI18n();
const log = useLogStore();
const pre = ref<HTMLElement | null>(null);

interface Line {
  kind: string;
  before: string;
  mark: string;
  after: string;
}

const lines = computed<Line[]>(() =>
  log.text.split('\n').map((line) => {
    const kind = classifyLogLine(line) ?? '';
    const pattern = kind ? LOG_HIGHLIGHT[kind as keyof typeof LOG_HIGHLIGHT] : undefined;
    const m = pattern ? pattern.exec(line) : null;
    if (!m) return { kind, before: line, mark: '', after: '' };
    return {
      kind,
      before: line.slice(0, m.index),
      mark: m[0],
      after: line.slice(m.index + m[0].length),
    };
  }),
);

// Keep the scroll position across refreshes.
watch(
  () => log.text,
  () => {
    const el = pre.value;
    if (!el) return;
    const top = el.scrollTop;
    requestAnimationFrame(() => (el.scrollTop = top));
  },
  { flush: 'pre' },
);
</script>

<template>
  <section class="card log-panel">
    <div class="card-head">
      <h2>{{ t('cards.log') }}</h2>
      <span class="hint">{{ t('log.newestFirst', { n: log.interval }) }}</span>
    </div>
    <div class="log-box">
      <pre
        ref="pre"
        tabindex="0"
        :aria-label="t('cards.log')"
      ><code><template v-for="(l, i) in lines" :key="i"><span class="log-line" :class="l.kind">{{ l.before }}<b v-if="l.mark" class="highlight">{{ l.mark }}</b>{{ l.after }}</span>{{ i < lines.length - 1 ? '\n' : '' }}</template></code></pre>
    </div>
  </section>
</template>

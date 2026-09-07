<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

/** An address to copy. The button touches the clipboard and nothing else. */
const props = defineProps<{ label: string; value: string }>();
const { t } = useI18n();
const done = ref(false);
const text = ref<HTMLElement | null>(null);

async function copy() {
  try {
    // navigator.clipboard exists only in a secure context (HTTPS or localhost).
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(props.value);
    } else {
      throw new Error('no clipboard');
    }
    done.value = true;
    setTimeout(() => (done.value = false), 1200);
  } catch {
    // Select the text at least, so Ctrl+C works.
    const el = text.value;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}
</script>

<template>
  <div class="copy-field">
    <span class="copy-label">{{ label }}</span>
    <div class="copy-row">
      <code ref="text" class="copy-text">{{ value }}</code>
      <button
        type="button"
        class="copy-button"
        :class="{ done }"
        :aria-label="t('electrum.copy', { label })"
        :title="done ? t('electrum.copied') : undefined"
        @click="copy"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
    </div>
  </div>
</template>

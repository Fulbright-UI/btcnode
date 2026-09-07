<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ControlMenu from '@/components/control/ControlMenu.vue';
import ChronicleTerminal from '@/components/layout/ChronicleTerminal.vue';
import { useFormat } from '@/composables/useFormat';
import { useNow } from '@/composables/useNow';
import { useAuthStore } from '@/stores/auth';
import { useStatusStore } from '@/stores/status';

const { t } = useI18n();
const format = useFormat();
const status = useStatusStore();
const auth = useAuthStore();
const now = useNow();

const snapshot = computed(() => status.snapshot);

/** Versions, state, uptime — one quiet line that only catches the eye when something is wrong. */
const info = computed(() => {
  const s = snapshot.value;
  if (!s) return null;
  const pieces: string[] = [];
  let warn = false;
  if (s.updates) {
    for (const e of s.updates.entries) {
      const short = e.name.startsWith('Bitcoin') ? t('header.core') : e.name;
      if (e.outdated && e.latest) {
        pieces.push(`${short} ${e.installed} → ${e.latest}`);
        warn = true;
      } else {
        pieces.push(`${short} ${e.installed}`);
      }
    }
  } else if (s.node?.userAgent) {
    pieces.push(s.node.userAgent);
  }
  if (s.node?.uptime) pieces.push(t('time.upFor', { duration: format.duration(s.node.uptime) }));
  if (!pieces.length) return null;
  let title = '';
  if (s.updates) {
    title = t('header.versionsChecked', { age: format.age(now.value - s.updates.checkedAt) });
    if (!s.updates.viaTor) title += t('header.inTheClear');
  }
  return { text: pieces.join(' · '), warn, title };
});

const stamp = computed(() => (snapshot.value ? format.dateTime(snapshot.value.generatedAt) : ''));
</script>

<template>
  <header>
    <div class="brand-group">
      <h1>
        <img class="brand-mark" src="/bitcoin.png" alt="" />
        {{ snapshot?.hostname ?? '' }} <b>· {{ t('app.brand') }}</b>
      </h1>
      <div class="header-info-zone">
        <div
          v-if="info"
          class="header-info"
          :class="{ warn: info.warn }"
          :title="info.title || undefined"
        >
          <span class="dot"></span><span>{{ info.text }}</span>
        </div>
      </div>
      <div class="header-right">
        <span class="pulse"></span>
        <span>{{
          stamp || (status.backendDown ? t('header.unreachable') : t('header.waitingForData'))
        }}</span>
        <ControlMenu v-if="auth.controlAvailable" />
      </div>
    </div>
    <div class="chronicle"><ChronicleTerminal /></div>
  </header>
</template>

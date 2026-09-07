<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '@/composables/useFormat';
import { useNow } from '@/composables/useNow';
import { useStatusStore } from '@/stores/status';

/**
 * The red card appears only once the node is really gone. Before that a
 * quiet note says the numbers are a little old — the whole difference
 * between "the node is broken" and "the node is writing its cache".
 */
const { t } = useI18n();
const format = useFormat();
const status = useStatusStore();
const now = useNow();
const state = computed(() => status.snapshot?.state ?? null);
const missingUnits = computed(() => status.snapshot?.logUnitsMissing ?? []);
const backendDownSince = computed(() =>
  status.backendDown && status.fetchedAt ? now.value - status.fetchedAt : null,
);
</script>

<template>
  <div class="notices">
    <div v-if="backendDownSince !== null" class="notice">
      <span class="status-dot"></span>
      <div>
        <b>{{ t('notices.backendDownTitle') }}</b>
        {{ t('notices.backendDownBody', { age: format.age(backendDownSince) }) }}
      </div>
    </div>
    <template v-if="state">
      <div v-if="state.level === 'starting' && state.warmupMessage" class="notice">
        <span class="status-dot"></span>
        <div>
          <b>{{ t('notices.startingTitle') }}</b>
          {{ t('notices.startingBody', { message: state.warmupMessage }) }}
        </div>
      </div>
      <div v-else-if="state.level === 'starting'" class="notice">
        <span class="status-dot"></span>
        <div>
          <b>{{ t('notices.noAnswerTitle') }}</b> {{ t('notices.noAnswerBody') }}
        </div>
      </div>
      <div v-else-if="state.level === 'stale'" class="notice">
        <span class="status-dot"></span>
        <div>
          <b>{{ t('notices.staleTitle') }}</b>
          {{ t('notices.staleBody', { age: format.age(state.staleFor ?? 0) }) }}
        </div>
      </div>
      <div v-else-if="state.level === 'error' && state.error" class="error-card">
        <template v-if="state.error.kind === 'unreachable'">
          <h2>{{ t('notices.unreachableTitle') }}</h2>
          <p>{{ state.error.message }}</p>
          <i18n-t keypath="notices.unreachableAdvice" tag="p">
            <template #status><code>systemctl status bitcoind</code></template>
            <template #journal><code>journalctl -u bitcoind -n 50</code></template>
          </i18n-t>
        </template>
        <template v-else-if="state.error.kind === 'auth'">
          <h2>{{ t('notices.authTitle') }}</h2>
          <p>{{ state.error.message }}</p>
          <i18n-t keypath="notices.authAdvice" tag="p">
            <template #rpcauth><code>rpcauth</code></template>
          </i18n-t>
        </template>
        <template v-else>
          <h2>{{ t('notices.rpcTitle') }}</h2>
          <p>{{ state.error.message }}</p>
          <i18n-t keypath="notices.rpcAdvice" tag="p">
            <template #whitelist><code>rpcwhitelist</code></template>
          </i18n-t>
        </template>
      </div>
    </template>
    <div v-for="unit in missingUnits" :key="unit" class="notice">
      <span class="status-dot"></span>
      <i18n-t keypath="notices.logUnitMissing" tag="div">
        <template #unit
          ><code>{{ unit }}.service</code></template
        >
      </i18n-t>
    </div>
  </div>
</template>

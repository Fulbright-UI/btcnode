<script setup lang="ts">
import { CONTROL_ACTIONS } from '@btcnode/shared';
import type { ControlAction } from '@btcnode/shared';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';

/**
 * The control panel lives in the header: a small toggle in the brand row
 * opens a popover with the login, then exactly four actions, each behind a
 * confirmation. The button asks the backend, the backend asks the host
 * agent, and the agent knows nothing but these four — there is no free-form
 * command anywhere on the way.
 */
const { t } = useI18n();
const auth = useAuthStore();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const password = ref('');
const loginError = ref<string | null>(null);
const busy = ref(false);
const pending = ref<ControlAction | null>(null);
const result = ref<{ ok: boolean; text: string } | null>(null);

const LABEL: Record<ControlAction, string> = {
  'restart-bitcoind': 'control.restartBitcoind',
  'restart-electrs': 'control.restartElectrs',
  reboot: 'control.reboot',
  poweroff: 'control.poweroff',
};
const DANGER: ReadonlySet<ControlAction> = new Set(['reboot', 'poweroff']);
// In the fixed order of CONTROL_ACTIONS, but only what the host can do:
// a node without an Electrum server gets no "restart electrs" button.
const actions = computed(() =>
  CONTROL_ACTIONS.filter((a) => auth.actions.includes(a)).map((a) => ({
    id: a,
    label: t(LABEL[a]),
    danger: DANGER.has(a),
  })),
);

function toggle() {
  open.value = !open.value;
  if (!open.value) pending.value = null;
}

function close() {
  open.value = false;
  pending.value = null;
}

async function login() {
  busy.value = true;
  loginError.value = null;
  result.value = null; // a stale "failed" from an expired session must not outlive the new login
  const err = await auth.login(password.value);
  busy.value = false;
  password.value = '';
  if (err === 'wrong') loginError.value = t('control.wrongPassword');
  else if (err === 'tooMany') loginError.value = t('control.tooMany');
  else if (err) loginError.value = t('control.unavailable');
}

async function confirm() {
  const action = pending.value;
  if (!action) return;
  busy.value = true;
  const r = await auth.run(action);
  busy.value = false;
  pending.value = null;
  result.value = r.ok
    ? { ok: true, text: t('control.done', { action: t(LABEL[action]) }) }
    : { ok: false, text: t('control.failed', { message: r.message ?? '' }) };
}

// Click outside or Escape closes the popover — a confirmation that stays
// open while the eye is elsewhere is an accident waiting to happen.
const onPointer = (e: MouseEvent) => {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close();
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') close();
};
onMounted(() => {
  document.addEventListener('mousedown', onPointer);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointer);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="control">
    <button
      type="button"
      class="control-toggle"
      :class="{ open, admin: auth.authenticated }"
      :aria-expanded="open"
      :aria-label="t('control.title')"
      :title="t('control.title')"
      @click="toggle"
    >
      <!-- A gear, not a word: the brand row is full at the usual width, and a word wrapped it. -->
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
        />
      </svg>
      <span v-if="auth.authenticated" class="dot"></span>
    </button>

    <div v-if="open" class="control-popover">
      <div class="control-head">
        <h2>{{ t('cards.control') }}</h2>
        <button v-if="auth.authenticated" type="button" @click="auth.logout()">
          {{ t('control.logout') }}
        </button>
      </div>

      <template v-if="!auth.authenticated">
        <form class="control-form" @submit.prevent="login">
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            :placeholder="t('control.password')"
            :disabled="busy"
            required
          />
          <button type="submit" :disabled="busy || !password">{{ t('control.login') }}</button>
        </form>
        <p class="control-status" :class="{ error: loginError }">{{ loginError ?? '' }}</p>
      </template>

      <template v-else>
        <div v-if="pending" class="control-confirm">
          <span>{{ t('control.confirm', { action: t(LABEL[pending]) }) }}</span>
          <button type="button" class="primary" :disabled="busy" @click="confirm">
            {{ t('control.yes') }}
          </button>
          <button type="button" :disabled="busy" @click="pending = null">
            {{ t('control.cancel') }}
          </button>
        </div>
        <div v-else class="control-actions">
          <button
            v-for="a in actions"
            :key="a.id"
            type="button"
            :class="{ danger: a.danger }"
            :disabled="busy"
            @click="((pending = a.id), (result = null))"
          >
            {{ a.label }}
          </button>
        </div>
        <p class="control-status" :class="result ? (result.ok ? 'good' : 'error') : ''">
          {{ result?.text ?? (pending === 'poweroff' ? t('control.hintPoweroff') : '') }}
        </p>
      </template>
    </div>
  </div>
</template>

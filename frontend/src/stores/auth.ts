import type { ControlAction, ControlResult } from '@btcnode/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ApiError, api } from '@/api/client';

export const useAuthStore = defineStore('auth', () => {
  const authenticated = ref(false);
  const controlAvailable = ref(false);
  const loaded = ref(false);

  async function load() {
    try {
      const s = await api.session();
      authenticated.value = s.authenticated;
      controlAvailable.value = s.controlAvailable;
    } catch {
      authenticated.value = false;
      controlAvailable.value = false;
    } finally {
      loaded.value = true;
    }
  }

  /** Resolves to null on success, else an error code the UI can translate. */
  async function login(password: string): Promise<null | 'wrong' | 'tooMany' | 'unavailable'> {
    try {
      const s = await api.login(password);
      authenticated.value = s.authenticated;
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return 'wrong';
      if (err instanceof ApiError && err.status === 429) return 'tooMany';
      return 'unavailable';
    }
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      authenticated.value = false;
    }
  }

  async function run(action: ControlAction): Promise<ControlResult> {
    try {
      return await api.control(action);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) authenticated.value = false;
      return { ok: false, action, message: err instanceof Error ? err.message : 'failed' };
    }
  }

  return { authenticated, controlAvailable, loaded, load, login, logout, run };
});

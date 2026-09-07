import type { UnitStatusProvider } from './electrum.js';
import { run } from '../util/exec.js';

/** On the host: ask systemd directly. */
export class SystemctlUnitStatus implements UnitStatusProvider {
  async isActive(unit: string): Promise<boolean | null> {
    const r = await run('systemctl', ['is-active', '--quiet', unit], { timeoutMs: 5000 });
    if (r.code === null) return null;
    return r.code === 0;
  }
}

/** Nobody to ask — the caller falls back to what it can observe itself. */
export class NoUnitStatus implements UnitStatusProvider {
  async isActive(): Promise<null> {
    return null;
  }
}

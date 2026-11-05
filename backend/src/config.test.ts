import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btcnode-config-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('configuration', () => {
  it('has safe defaults: local only, secure cookie, no control, no update check', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      HOST: '127.0.0.1',
      PORT: 3000,
      SESSION_SECURE_COOKIE: true,
      UPDATE_CHECK: false,
      rpcPassword: '',
      adminPasswordHash: null,
      sessionKey: null,
      logUnits: ['bitcoind'],
    });
    expect(c.AGENT_SOCKET).toBeUndefined();
    expect(c.unitDirs).toContain('/etc/systemd/system');
  });

  it('reads secrets from files and splits lists', async () => {
    const key = 'ab'.repeat(32);
    await writeFile(join(dir, 'rpc'), 'from-file\n');
    await writeFile(join(dir, 'hash'), '$2a$12$hash\n');
    await writeFile(join(dir, 'key'), `${key}\n`);
    const c = loadConfig({
      BITCOIN_RPC_PASSWORD: 'inline-loses',
      BITCOIN_RPC_PASSWORD_FILE: join(dir, 'rpc'),
      ADMIN_PASSWORD_HASH_FILE: join(dir, 'hash'),
      SESSION_KEY_FILE: join(dir, 'key'),
      LOG_UNITS: ' bitcoind, electrs ,,',
      SYSTEMD_UNIT_DIRS: '/a,/b',
      UPDATE_CHECK: 'Yes',
      SESSION_SECURE_COOKIE: 'off',
    });
    expect(c.rpcPassword).toBe('from-file');
    expect(c.adminPasswordHash).toBe('$2a$12$hash');
    expect(c.sessionKey?.toString('hex')).toBe(key);
    expect(c.logUnits).toEqual(['bitcoind', 'electrs']);
    expect(c.unitDirs).toEqual(['/a', '/b']);
    expect(c.UPDATE_CHECK).toBe(true);
    expect(c.SESSION_SECURE_COOKIE).toBe(false);
  });

  it('fails loudly on a wrong value instead of guessing', () => {
    expect(() => loadConfig({ STATUS_INTERVAL: '30s' })).toThrow(/STATUS_INTERVAL/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ SESSION_KEY: 'short' })).toThrow(/64 hex/);
  });
});

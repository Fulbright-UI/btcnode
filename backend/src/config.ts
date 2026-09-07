import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Configuration comes from the environment (twelve-factor), validated once
 * at start. A wrong value fails loudly here instead of freezing a page for
 * days — the old generator swallowed `INTERVAL=30s` and stopped writing.
 */
const boolish = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()))
  .or(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Shown in the header and the page title */
  HOSTNAME: z.string().default('btcnode'),

  BITCOIN_RPC_URL: z.string().url().default('http://127.0.0.1:8332/'),
  BITCOIN_RPC_USER: z.string().default('dashboard'),
  BITCOIN_RPC_PASSWORD: z.string().default(''),
  /** Alternative to the inline password: a file with the password only */
  BITCOIN_RPC_PASSWORD_FILE: z.string().optional(),
  /** 45 s, not 15: bitcoind stalls its RPC thread while writing the dbcache */
  BITCOIN_RPC_TIMEOUT: z.coerce.number().int().min(5).max(600).default(45),
  /** Used only for the disk-space figure */
  BITCOIN_DATA_DIR: z.string().default('/mnt/bitcoin/bitcoin'),

  ELECTRUM_PORT: z.coerce.number().int().min(1).max(65535).default(50001),
  ELECTRS_METRICS_URL: z.string().url().default('http://127.0.0.1:4224/'),
  ELECTRS_ONION_FILE: z.string().default('/etc/electrs/onion'),
  ELECTRS_UNIT: z.string().default('electrs'),

  STATUS_INTERVAL: z.coerce.number().int().min(5).max(600).default(21),
  LOG_INTERVAL: z.coerce.number().int().min(1).max(120).default(3),
  /** Failed passes in a row before the node counts as gone */
  TOLERANCE: z.coerce.number().int().min(1).default(3),
  PEERS_MAX: z.coerce.number().int().min(1).max(1024).default(64),

  /** Comma-separated systemd units whose journal fills the log panel */
  LOG_UNITS: z.string().default('bitcoind'),
  LOG_LINES: z.coerce.number().int().min(5).max(500).default(150),
  /** Journal directory when reading a host journal from inside a container */
  JOURNAL_DIR: z.string().optional(),
  /** Directory that holds the systemd units (to tell "not installed" from "no access") */
  SYSTEMD_UNIT_DIRS: z
    .string()
    .default('/etc/systemd/system,/run/systemd/system,/usr/lib/systemd/system,/lib/systemd/system'),

  UPDATES_FILE: z.string().default('/var/lib/btcnode/updates.json'),
  /** Weekly version check; off by default outside the deploy that enables it */
  UPDATE_CHECK: boolish.default(false),
  UPDATE_CHECK_TOR_PROXY: z.string().optional(),

  /** Control: the host agent's socket. Absent → the control panel is hidden. */
  AGENT_SOCKET: z.string().optional(),
  /** bcrypt hash of the admin password, or a file holding it */
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_PASSWORD_HASH_FILE: z.string().optional(),
  /** 32-byte hex key for the session cookie, or a file holding it */
  SESSION_KEY: z.string().optional(),
  SESSION_KEY_FILE: z.string().optional(),
  /** Cookie `secure` flag — only turn off for plain-http development */
  SESSION_SECURE_COOKIE: boolish.default(true),

  /** Where to look for the host's thermal/hwmon/proc files (overridable for tests) */
  SYSFS_THERMAL: z.string().default('/sys/class/thermal/thermal_zone0/temp'),
  SYSFS_HWMON: z.string().default('/sys/class/hwmon'),
  PROC_DIR: z.string().default('/proc'),
});

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  rpcPassword: string;
  logUnits: string[];
  unitDirs: string[];
  adminPasswordHash: string | null;
  sessionKey: Buffer | null;
}

function readSecret(inline: string | undefined, file: string | undefined): string | undefined {
  if (file) return readFileSync(file, 'utf8').trim();
  return inline;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${issues.join('\n  ')}`);
  }
  const e = parsed.data;
  const keyHex = readSecret(e.SESSION_KEY, e.SESSION_KEY_FILE);
  if (keyHex !== undefined && !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('SESSION_KEY must be 32 bytes as 64 hex characters');
  }
  return {
    ...e,
    rpcPassword: readSecret(e.BITCOIN_RPC_PASSWORD, e.BITCOIN_RPC_PASSWORD_FILE) ?? '',
    logUnits: e.LOG_UNITS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    unitDirs: e.SYSTEMD_UNIT_DIRS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adminPasswordHash: readSecret(e.ADMIN_PASSWORD_HASH, e.ADMIN_PASSWORD_HASH_FILE) ?? null,
    sessionKey: keyHex ? Buffer.from(keyHex, 'hex') : null,
  };
}

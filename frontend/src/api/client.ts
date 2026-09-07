import {
  chronicleSchema,
  controlResultSchema,
  sessionInfoSchema,
  statusSnapshotSchema,
} from '@btcnode/shared';
import type {
  Chronicle,
  ControlAction,
  ControlResult,
  SessionInfo,
  StatusSnapshot,
} from '@btcnode/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The header a cross-site request cannot add — the CSRF guard next to SameSite=Strict. */
const CSRF = { 'x-requested-with': 'btcnode' };

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, `${path}: HTTP ${res.status}`);
  return schema.parse(await res.json());
}

async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { ...CSRF, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new ApiError(res.status, `${path}: HTTP ${res.status}`);
  return schema.parse(await res.json());
}

export const api = {
  status: (): Promise<StatusSnapshot> => getJson('/api/status', statusSnapshotSchema),
  chronicle: (): Promise<Chronicle> => getJson('/api/chronicle', chronicleSchema),
  async log(): Promise<string> {
    const res = await fetch('/api/log', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, `/api/log: HTTP ${res.status}`);
    return res.text();
  },
  session: (): Promise<SessionInfo> => getJson('/api/auth/session', sessionInfoSchema),
  login: (password: string): Promise<SessionInfo> =>
    postJson('/api/auth/login', { password }, sessionInfoSchema),
  logout: (): Promise<SessionInfo> => postJson('/api/auth/logout', undefined, sessionInfoSchema),
  control: (action: ControlAction): Promise<ControlResult> =>
    postJson('/api/control', { action }, controlResultSchema),
};

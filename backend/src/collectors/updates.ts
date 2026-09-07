import { updatesSchema } from '@btcnode/shared';
import type { StatusSnapshot } from '@btcnode/shared';
import { readText } from '../util/fs.js';

/** The result of the version check, written by the update checker as JSON. */
export async function readUpdates(path: string): Promise<StatusSnapshot['updates']> {
  const raw = await readText(path);
  if (!raw) return null;
  try {
    const parsed = updatesSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.entries.length ? parsed.data : null;
  } catch {
    return null;
  }
}

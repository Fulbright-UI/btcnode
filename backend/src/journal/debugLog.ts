import { open, stat } from 'node:fs/promises';
import type { JournalReader } from './journalctl.js';
import { parseTimestamp } from './parse.js';

/**
 * Reads Bitcoin Core's own debug.log instead of the systemd journal — for a
 * bitcoind that runs in a container, where there is no unit and no journal
 * entry, only the file in the data directory (which is mounted anyway for
 * the disk figure). Core writes every line with its own UTC timestamp, so
 * nothing is lost against the journal except the host clock.
 *
 * The file grows to gigabytes; only its tail is ever read. `since` scans
 * backwards in chunks until the lines are older than asked for.
 */
export class DebugLogReader implements JournalReader {
  constructor(
    private readonly path: string,
    private readonly chunkBytes = 512 * 1024,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  async tail(_unit: string, lines: number) {
    return this.read((collected) => collected.length >= lines, lines);
  }

  async since(_unit: string, hours: number, maxLines: number) {
    const cutoff = Date.now() / 1000 - hours * 3600;
    const r = await this.read((collected) => {
      const oldest = collected[0];
      return oldest !== undefined && parseTimestamp(oldest, Infinity) < cutoff;
    }, maxLines);
    if (!r.ok) return r;
    return { ok: true as const, lines: r.lines.filter((l) => parseTimestamp(l, cutoff) >= cutoff) };
  }

  /** Read chunks from the end until `enough(lines)` holds, return the newest `keep` lines, oldest first. */
  private async read(enough: (lines: string[]) => boolean, keep: number) {
    let handle;
    try {
      handle = await open(this.path, 'r');
    } catch (err) {
      return { ok: false as const, error: `${this.path}: ${(err as Error).message}` };
    }
    try {
      const size = (await stat(this.path)).size;
      let position = size;
      let text = '';
      let lines: string[] = [];
      while (position > 0 && size - position < this.maxBytes) {
        const length = Math.min(this.chunkBytes, position);
        position -= length;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, position);
        text = buffer.toString('utf8') + text;
        lines = text.split('\n');
        // the first element may be a partial line unless we are at the start
        if (position > 0) lines.shift();
        lines = lines.filter((l) => l.trim() !== '');
        if (enough(lines)) break;
      }
      return { ok: true as const, lines: lines.slice(-keep) };
    } catch (err) {
      return { ok: false as const, error: `${this.path}: ${(err as Error).message}` };
    } finally {
      await handle.close();
    }
  }
}

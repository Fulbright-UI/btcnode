import { run } from '../util/exec.js';

export interface JournalReader {
  /** Newest `lines` lines of a unit, oldest first. */
  tail(
    unit: string,
    lines: number,
  ): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }>;
  /** Lines of the last `hours` hours, capped at `maxLines`, oldest first. */
  since(
    unit: string,
    hours: number,
    maxLines: number,
  ): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }>;
}

/**
 * Reads the systemd journal through `journalctl`. Inside a container the
 * host's journal directory is mounted read-only and passed as `-D`; the
 * container user needs the host's `systemd-journal` group for the files.
 */
export class JournalctlReader implements JournalReader {
  constructor(private readonly directory?: string) {}

  private base(unit: string): string[] {
    const args = ['-u', unit, '--no-pager', '--output=short-iso', '--quiet'];
    if (this.directory) args.unshift('-D', this.directory);
    return args;
  }

  private async exec(args: string[], timeoutMs: number) {
    const r = await run('journalctl', args, { timeoutMs, maxBytes: 32 * 1024 * 1024 });
    if (r.code !== 0) {
      return { ok: false as const, error: r.stderr.trim() || `journalctl exited with ${r.code}` };
    }
    return { ok: true as const, lines: r.stdout.split('\n').filter((l) => l.trim() !== '') };
  }

  tail(unit: string, lines: number) {
    return this.exec([...this.base(unit), '-n', String(lines)], 10_000);
  }

  since(unit: string, hours: number, maxLines: number) {
    return this.exec([...this.base(unit), '--since', `-${hours}h`, '-n', String(maxLines)], 20_000);
  }
}

import { execFile } from 'node:child_process';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a command with a hard timeout and a bounded output; never throws. */
export function run(
  file: string,
  args: string[],
  opts: { timeoutMs: number; maxBytes?: number } = { timeoutMs: 10_000 },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs, maxBuffer: opts.maxBytes ?? 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && !('code' in err && typeof err.code === 'number')) {
          resolve({ code: null, stdout: stdout ?? '', stderr: err.message });
          return;
        }
        resolve({ code: err ? (err.code as number) : 0, stdout, stderr });
      },
    );
  });
}

export async function portOpen(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  const { createConnection } = await import('node:net');
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

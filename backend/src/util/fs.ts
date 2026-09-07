import { readFile, readdir, statfs, access } from 'node:fs/promises';
import { join } from 'node:path';

export async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return null;
  }
}

export async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function diskUsage(
  path: string,
): Promise<{ total: number; free: number; used: number } | null> {
  try {
    const s = await statfs(path);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

/** Is there a systemd unit of this name in any of the unit directories? */
export async function unitExists(name: string, unitDirs: string[]): Promise<boolean> {
  const file = name.endsWith('.service') ? name : `${name}.service`;
  for (const dir of unitDirs) {
    if (await exists(join(dir, file))) return true;
  }
  return false;
}

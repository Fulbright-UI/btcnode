import { join } from 'node:path';
import type { StatusSnapshot } from '@btcnode/shared';
import type { TemperatureHistory } from '../history/temperature.js';
import { diskUsage, listDir, readText } from '../util/fs.js';
import { run } from '../util/exec.js';

export interface SystemCollectorOptions {
  procDir: string;
  thermalFile: string;
  hwmonDir: string;
  dataDir: string;
}

type SystemStatus = StatusSnapshot['system'];

/** CPU use between two passes from the first line of /proc/stat. */
export class CpuMeter {
  private last: { busy: number; total: number } | null = null;

  constructor(private readonly procDir: string) {}

  private async sample(): Promise<{ busy: number; total: number } | null> {
    const raw = await readText(join(this.procDir, 'stat'));
    const first = raw?.split('\n')[0]?.split(/\s+/);
    if (!first || first[0] !== 'cpu' || first.length < 5) return null;
    const values = first.slice(1).map(Number);
    const idle = (values[3] ?? 0) + (values[4] ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    return { busy: total - idle, total };
  }

  async percent(): Promise<number | null> {
    let now = await this.sample();
    if (!now) return null;
    if (!this.last) {
      // Nothing to compare against on the first call: a second sample a
      // quarter of a second later, once at startup.
      this.last = now;
      await new Promise((r) => setTimeout(r, 250));
      now = await this.sample();
      if (!now) return null;
    }
    const busy = now.busy - this.last.busy;
    const total = now.total - this.last.total;
    this.last = now;
    if (total <= 0) return null;
    return Math.min(100, (100 * busy) / total);
  }
}

/**
 * Undervoltage is the most common cause of corrupted chain data. Three
 * sources, in order: the firmware's sysfs file (absent on current Pi 4
 * kernels), the hwmon driver `rpi_volt` (in0_lcrit_alarm = 1 while the
 * supply is below threshold), and `vcgencmd` — which needs /dev/vchiq and
 * fails silently in a sandboxed service.
 */
export async function readThrottled(hwmonDir: string): Promise<number | null> {
  const raw = await readText('/sys/devices/platform/soc/soc:firmware/get_throttled');
  if (raw) {
    const v = Number.parseInt(raw.toLowerCase().replace(/^0x/, ''), 16);
    if (!Number.isNaN(v)) return v;
  }
  for (const entry of await listDir(hwmonDir)) {
    const base = join(hwmonDir, entry);
    if ((await readText(join(base, 'name'))) !== 'rpi_volt') continue;
    const alarm = await readText(join(base, 'in0_lcrit_alarm'));
    if (alarm === '0' || alarm === '1') return alarm === '1' ? 0x1 : 0;
  }
  const r = await run('vcgencmd', ['get_throttled'], { timeoutMs: 5000 });
  if (r.code === 0 && r.stdout.includes('=')) {
    const v = Number.parseInt(r.stdout.trim().split('=')[1] ?? '', 16);
    if (!Number.isNaN(v)) return v;
  }
  return null;
}

export class SystemCollector {
  private readonly cpu: CpuMeter;

  constructor(
    private readonly opts: SystemCollectorOptions,
    private readonly temperatures: TemperatureHistory,
  ) {
    this.cpu = new CpuMeter(opts.procDir);
  }

  async collect(): Promise<SystemStatus> {
    const tempRaw = await readText(this.opts.thermalFile);
    let temperature: number | null = null;
    if (tempRaw && /^\d+$/.test(tempRaw)) {
      temperature = Number(tempRaw) / 1000;
      this.temperatures.record(temperature);
    }

    const meminfo = (await readText(join(this.opts.procDir, 'meminfo'))) ?? '';
    let total = 0;
    let available = 0;
    for (const row of meminfo.split('\n')) {
      if (row.startsWith('MemTotal:')) total = Number(row.split(/\s+/)[1]) * 1024;
      else if (row.startsWith('MemAvailable:')) available = Number(row.split(/\s+/)[1]) * 1024;
    }

    const uptimeRaw = await readText(join(this.opts.procDir, 'uptime'));
    const uptime = uptimeRaw ? Number(uptimeRaw.split(/\s+/)[0]) : null;

    const throttled = await readThrottled(this.opts.hwmonDir);

    return {
      temperature,
      temperatureHourly: this.temperatures.list,
      cpuPercent: await this.cpu.percent(),
      memory: total ? { used: total - available, total } : null,
      disk: await diskUsage(this.opts.dataDir),
      uptime: uptime !== null && Number.isFinite(uptime) ? uptime : null,
      power:
        throttled === null
          ? null
          : {
              undervoltageNow: (throttled & 0x1) !== 0,
              undervoltageSinceBoot: (throttled & 0x40000) !== 0,
              throttled: (throttled & 0x4) !== 0,
            },
    };
  }
}

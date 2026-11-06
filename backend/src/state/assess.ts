import { THRESHOLDS, peerLatency } from '@btcnode/shared';
import type { StatusSnapshot, Warning } from '@btcnode/shared';

type Facts = Pick<
  StatusSnapshot,
  'node' | 'system' | 'electrum' | 'chainCheck' | 'updates' | 'peers'
>;

/**
 * Harvest the notices from the facts. Every threshold lives in THRESHOLDS;
 * the frontend reads the same table to colour the values, so nothing can be
 * yellow here and green there. Order matters: the first notice is the one
 * the state bar names, and a stranger ahead of us is the one thing that
 * means the node might be lied to.
 */
export function collectWarnings(f: Facts): Warning[] {
  const w: Warning[] = [];
  if (f.chainCheck.alarm)
    w.push({ code: 'chainCheckAhead', params: { blocks: f.chainCheck.ahead } });

  const s = f.system;
  if (s.temperature !== null && s.temperature >= THRESHOLDS.temperatureHigh) {
    w.push({ code: 'temperature', params: { value: s.temperature } });
  }
  if (s.cpuPercent !== null && s.cpuPercent >= THRESHOLDS.cpuWarn) {
    w.push({ code: 'cpu', params: { value: Math.round(s.cpuPercent) } });
  }
  if (s.memory && s.memory.used / s.memory.total > THRESHOLDS.memoryWarn) {
    w.push({
      code: 'memory',
      params: { percent: Math.round((100 * s.memory.used) / s.memory.total) },
    });
  }
  if (s.disk && s.disk.used / s.disk.total >= THRESHOLDS.diskWarn) {
    w.push({ code: 'disk', params: { percent: Math.round((100 * s.disk.used) / s.disk.total) } });
  }
  if (s.power && (s.power.undervoltageNow || s.power.undervoltageSinceBoot || s.power.throttled)) {
    w.push({ code: 'power' });
  }

  const n = f.node;
  if (n) {
    if (n.connections.total < THRESHOLDS.connectionsMin) {
      w.push({ code: 'connections', params: { value: n.connections.total } });
    }
    if (n.mempool.maxUsage && n.mempool.usage / n.mempool.maxUsage >= THRESHOLDS.mempoolFullWarn) {
      w.push({ code: 'mempoolFull' });
    }
  }

  const e = f.electrum;
  if (e.configured) {
    if (!e.running) w.push({ code: 'electrumStopped' });
    else if (!e.reachable) w.push({ code: 'electrumNotResponding' });
    else if (n && e.indexedHeight !== null && n.blocks - e.indexedHeight > 1) {
      w.push({ code: 'electrumIndexing', params: { blocks: n.blocks - e.indexedHeight } });
    }
  }

  for (const l of peerLatency(f.peers.list)) {
    if (l.slow)
      w.push({
        code: 'peerLatencySlow',
        params: { network: l.network, ms: Math.round(l.medianMs) },
      });
  }

  if (f.updates?.entries.some((u) => u.outdated)) w.push({ code: 'updatesAvailable' });
  return w;
}

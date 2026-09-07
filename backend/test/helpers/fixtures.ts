import type { JournalReader } from '../../src/journal/journalctl.js';

/** Journal lines the way Core 31.x writes them, with fresh timestamps. */
export function journalLines(tip: number, now = Date.now()): string[] {
  const iso = (secondsAgo: number) =>
    new Date(now - secondsAgo * 1000).toISOString().slice(0, 19) + '+00:00';
  const line = (secondsAgo: number, msg: string) =>
    `${iso(secondsAgo)} btcnode bitcoind[1234]: ${iso(secondsAgo).slice(0, 19)}Z ${msg}`;
  const out: string[] = [];
  // the node restarted three hours ago
  out.push(line(3 * 3600, 'Bitcoin Core version v31.1.0 (release build)'));
  // 60 announcements over the day, some before the restart
  for (let i = 60; i >= 1; i--) {
    const height = tip - i;
    const age = i * 600 + 41;
    const peer = i % 5 === 0 ? 104 : i % 7 === 0 ? 999 : 3;
    out.push(
      line(
        age,
        `Saw new cmpctblock header hash=00000000000000000001abc height=${height} peer=${peer}`,
      ),
    );
    if (i % 4 === 0) {
      out.push(
        line(
          age - 100,
          `UpdateTip: new best=00000000000000000001abc height=${height} version=0x20000000 log2_work=95.1 tx=1200000000 date='2026-09-06T12:00:00Z' progress=1.000000 cache=12.8MiB(90000txo)`,
        ),
      );
    }
  }
  out.push(line(41, `Saw new cmpctblock header hash=00000000000000000001abc height=${tip} peer=3`));
  // chain-check samples of the last hour: same, behind, one ahead claim
  const samples: [number, number][] = [
    [50 * 60, 0],
    [40 * 60, -3],
    [30 * 60, 0],
    [20 * 60, 0],
    [10 * 60, 0],
    [6 * 60, 0],
  ];
  samples.forEach(([age, delta], i) => {
    const ownThen = tip - Math.floor(age / 600);
    out.push(
      line(
        age,
        `New block-relay-only peer connected: transport: v2, version: 70016, blocks=${ownThen + delta} peer=${800 + i}`,
      ),
    );
  });
  out.push(line(30, 'Potential stale tip detected, will try using extra outbound peer'));
  out.push(line(20, 'Warning: something odd'));
  return out;
}

export class FakeJournal implements JournalReader {
  constructor(public lines: string[]) {}
  async tail(_unit: string, n: number) {
    return { ok: true as const, lines: this.lines.slice(-n) };
  }
  async since(_unit: string, _hours: number, max: number) {
    return { ok: true as const, lines: this.lines.slice(-max) };
  }
}

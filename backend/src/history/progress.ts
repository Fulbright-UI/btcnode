const SHORT_MAX = 120;
const SHORT_MIN_GAP = 300; // no estimate before 5 minutes of distance
const LONG_STEP = 300;
const LONG_MAX = 144;

/**
 * Sync progress over time. The rate is taken from `verificationprogress`,
 * not from block counts: early blocks are nearly empty and fly past, later
 * ones are full — Core already weights progress by the work involved.
 */
export class ProgressTracker {
  private short: [number, number][] = [];
  private long: [number, number][] = [];

  constructor(private readonly now: () => number = () => Date.now() / 1000) {}

  get history(): [number, number][] {
    return this.long.slice();
  }

  record(fraction: number): void {
    const t = this.now();
    if (!this.long.length || t - (this.long[this.long.length - 1]?.[0] ?? 0) >= LONG_STEP) {
      this.long.push([t, fraction]);
      if (this.long.length > LONG_MAX) this.long = this.long.slice(-LONG_MAX);
    }
  }

  /** {ratePerHour in percentage points, remainingSeconds} or null while measuring. */
  estimate(fraction: number): { ratePerHour: number; remainingSeconds: number } | null {
    const t = this.now();
    this.short.push([t, fraction]);
    if (this.short.length > SHORT_MAX) this.short = this.short.slice(-SHORT_MAX);
    let base: [number, number] | null = null;
    for (const sample of this.short) {
      if (t - sample[0] >= SHORT_MIN_GAP) base = sample;
      else break;
    }
    if (!base) return null;
    const dt = t - base[0];
    const dp = fraction - base[1];
    if (dt <= 0 || dp <= 0) return null;
    return { ratePerHour: (dp / dt) * 3600 * 100, remainingSeconds: (1 - fraction) / (dp / dt) };
  }
}

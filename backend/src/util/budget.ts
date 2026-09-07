/**
 * One pass is a straight line: query, build, publish. The first fill asks
 * for 144 blocks and hundreds of hashrate points, and each call may wait the
 * full RPC timeout — without a budget a single pass could hold the loop for
 * hours. Once the budget is spent, history fetches stop and continue on the
 * next pass; both caches are incremental by design.
 */
export class PassBudget {
  private readonly deadline: number;

  constructor(
    seconds: number,
    private readonly now: () => number = () => performance.now() / 1000,
  ) {
    this.deadline = this.now() + Math.max(10, seconds);
  }

  /** Seconds left in this pass. */
  left(): number {
    return Math.max(0, this.deadline - this.now());
  }

  spent(): boolean {
    return this.left() <= 0;
  }
}

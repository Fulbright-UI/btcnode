/** The peak of every clock hour, 24 slots, oldest first. */
export class TemperatureHistory {
  private hours: { hour: number; peak: number }[] = [];

  constructor(private readonly now: () => number = () => Date.now() / 1000) {}

  get list(): { hour: number; peak: number }[] {
    return this.hours.map((h) => ({ ...h }));
  }

  record(celsius: number): void {
    const t = this.now();
    const hour = t - (t % 3600);
    const last = this.hours[this.hours.length - 1];
    if (last && last.hour === hour) {
      last.peak = Math.max(last.peak, celsius);
    } else {
      this.hours.push({ hour, peak: celsius });
      if (this.hours.length > 24) this.hours = this.hours.slice(-24);
    }
  }
}

// The server's guard on feed rebuilds: at most one start per interval, and a
// call while one runs joins it rather than starting another.

/** How often the panel may ask the board host to rebuild the feed. */
export const REFRESH_INTERVAL_MS = 15_000;

export type Limited<T> = { ok: true; value: T } | { ok: false; retryInMs: number };

export class RefreshLimiter {
  private lastStart: number | null = null;
  private running: Promise<Limited<unknown>> | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Runs `task` unless one started within the interval; failed runs count too. */
  run<T>(task: () => Promise<T>): Promise<Limited<T>> {
    if (this.running) return this.running as Promise<Limited<T>>;
    const at = this.now();
    if (this.lastStart !== null && at - this.lastStart < this.intervalMs) {
      return Promise.resolve({ ok: false, retryInMs: this.intervalMs - (at - this.lastStart) });
    }
    this.lastStart = at;
    const running = task()
      .then((value): Limited<T> => ({ ok: true, value }))
      .finally(() => {
        this.running = null;
      });
    this.running = running;
    return running;
  }
}

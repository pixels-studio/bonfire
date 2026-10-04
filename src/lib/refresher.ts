/** Longest a check waits after failing again and again, such as while offline. */
const MAX_BACKOFF_MS = 5 * 60_000;

/** Whether anyone can see the app, which decides whether loading anything is worth it. */
export type Page = {
  visible(): boolean;
  /** Calls `listener` when the app comes back into view; returns what stops it. */
  onReturn(listener: () => void): () => void;
};

export const page: Page = {
  visible: () => !document.hidden,
  onReturn(listener) {
    const onVisibility = () => {
      if (!document.hidden) listener();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  },
};

export type RefresherOptions = {
  /**
   * How often to check back, for what nothing reports changes to, such as GitHub or a remote
   * folder. Without one, it loads only when told something changed.
   */
  intervalMs?: number;
  /** The least time between loads that a change starts, for what is costly to load. */
  minGapMs?: number;
  page?: Page;
  now?: () => number;
};

/**
 * How long until the next check: the next multiple of the interval on the clock, so that
 * views checking the same thing ask in the same instant and main can answer them with one
 * run. After failures in a row the wait doubles for each, up to `maxMs`, spread by ±20% so
 * that retries don't land together.
 */
export function nextDelay(
  intervalMs: number,
  failures: number,
  now: number,
  { maxMs = MAX_BACKOFF_MS, random = Math.random } = {},
) {
  if (!failures) return intervalMs - (now % intervalMs);
  const delay = Math.min(intervalMs * 2 ** failures, maxMs);
  return delay * (0.8 + 0.4 * random());
}

/**
 * Keeps something loaded: again whenever it is told of a change, and on an interval when
 * given one. One load runs at a time; a change during it loads once more afterwards, since
 * that load may have started before the change. Nothing loads while the app is out of view;
 * what changed meanwhile loads once when it comes back. A load that throws makes the next
 * interval longer, until one succeeds.
 */
export class Refresher {
  private intervalMs?: number;
  private readonly minGapMs: number;
  private readonly page: Page;
  private readonly now: () => number;
  private timer?: ReturnType<typeof setTimeout>;
  private dueAt = Infinity;
  private running?: Promise<void>;
  private queued?: Promise<void>;
  private lastStart = -Infinity;
  /** Something changed, or came due, while the app was out of view. */
  private stale = false;
  private failures = 0;
  private stopped = false;
  private readonly stopReturn: () => void;

  constructor(
    private readonly load: () => unknown,
    options: RefresherOptions = {},
  ) {
    this.intervalMs = options.intervalMs;
    this.minGapMs = options.minGapMs ?? 0;
    this.page = options.page ?? page;
    this.now = options.now ?? Date.now;
    this.stopReturn = this.page.onReturn(() => {
      if (this.stale) void this.refresh();
    });
    this.schedule();
  }

  /** Loads now, or right after the load underway; settles once a load has caught up. */
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running)
      return (this.queued ??= this.running.then(() => {
        this.queued = undefined;
        return this.refresh();
      }));
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dueAt = Infinity;
    this.stale = false;
    // Settled in a later tick, after `running` is set, even when `load` throws at once.
    this.running = this.run().finally(() => {
      this.running = undefined;
      this.schedule();
    });
    return this.running;
  }

  /**
   * Says what it loads has changed; it loads again soon, or once the app is back in view.
   * A change that matters less can ask for a longer gap since the last load.
   */
  invalidate(minGapMs = this.minGapMs) {
    if (this.stopped) return;
    if (!this.page.visible()) {
      this.stale = true;
      return;
    }
    const wait = this.lastStart + minGapMs - this.now();
    if (wait > 0) this.wake(wait);
    else void this.refresh();
  }

  /** Starts or stops checking back, such as once it is known whether changes are reported. */
  setInterval(intervalMs: number | undefined) {
    if (intervalMs === this.intervalMs) return;
    this.intervalMs = intervalMs;
    if (!this.running) this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.stopReturn();
  }

  private async run() {
    this.lastStart = this.now();
    try {
      await this.load();
      this.failures = 0;
    } catch {
      this.failures++;
    }
  }

  private schedule() {
    if (this.stopped || this.intervalMs === undefined) return;
    this.wake(nextDelay(this.intervalMs, this.failures, this.now()));
  }

  /** Sets the timer for `delay` from now, unless it is already set to go off sooner. */
  private wake(delay: number) {
    const at = this.now() + delay;
    if (this.timer !== undefined && this.dueAt <= at) return;
    clearTimeout(this.timer);
    this.dueAt = at;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.dueAt = Infinity;
      if (this.page.visible()) void this.refresh();
      else this.stale = true;
    }, delay);
  }
}

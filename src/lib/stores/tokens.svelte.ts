import type { TokenRange, TokenStats } from '$shared/contracts';

type Entry = { stats?: TokenStats; error?: string; loading: boolean };

/** Token usage per range. Earlier results stay on screen while a refresh runs. */
class TokenStore {
  range = $state<TokenRange>('today');
  entries = $state<Record<TokenRange, Entry>>({
    today: { loading: false },
    '7d': { loading: false },
    '30d': { loading: false },
  });
  #running: Partial<Record<TokenRange, Promise<void>>> = {};
  #queued: Partial<Record<TokenRange, Promise<void>>> = {};

  get current() {
    return this.entries[this.range];
  }

  select(range: TokenRange) {
    this.range = range;
    void this.refresh();
  }

  /**
   * Reads the range again. Asked during a read, it reads once more afterwards, since the
   * read underway may have started before the logs it was asked for were written.
   */
  refresh(range = this.range): Promise<void> {
    if (!window.bonfire) return Promise.resolve();
    const running = this.#running[range];
    if (running)
      return (this.#queued[range] ??= running.then(() => {
        this.#queued[range] = undefined;
        return this.refresh(range);
      }));
    const entry = this.entries[range];
    entry.loading = true;
    const load = window.bonfire.tokens
      .get(range)
      .then((stats) => {
        entry.stats = stats;
        entry.error = undefined;
      })
      .catch((cause) => {
        entry.error = cause instanceof Error ? cause.message : String(cause);
      })
      .finally(() => {
        entry.loading = false;
        this.#running[range] = undefined;
      });
    this.#running[range] = load;
    return load;
  }
}

export const tokens = new TokenStore();

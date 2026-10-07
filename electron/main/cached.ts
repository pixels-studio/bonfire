/**
 * A value loaded on demand and reused for `ttlMs`. Concurrent reads share one load.
 * With `serveStale`, a failed reload returns the last value instead of the error.
 */
export class Cached<Value> {
  private entry?: { at: number; value: Value };
  private pending?: Promise<Value>;

  constructor(
    private readonly load: () => Promise<Value>,
    private readonly ttlMs: number,
    private readonly options: { serveStale?: boolean } = {},
  ) {}

  get(): Promise<Value> {
    if (this.entry && Date.now() - this.entry.at < this.ttlMs)
      return Promise.resolve(this.entry.value);
    this.pending ??= this.load()
      .then((value) => {
        this.entry = { at: Date.now(), value };
        return value;
      })
      .catch((cause) => {
        if (this.options.serveStale && this.entry) return this.entry.value;
        throw cause;
      })
      .finally(() => (this.pending = undefined));
    return this.pending;
  }

  /**
   * Takes a change learned some other way, such as pushed by the provider, as just loaded.
   * `change` gets the last value (stale or not) and returns undefined to leave it alone.
   */
  update(change: (previous: Value | undefined) => Value | undefined) {
    const value = change(this.entry?.value);
    if (value !== undefined) this.entry = { at: Date.now(), value };
  }

  /** Forgets the value, so the next read loads it again. */
  clear() {
    this.entry = undefined;
  }
}

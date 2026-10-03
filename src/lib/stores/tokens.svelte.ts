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

  get current() {
    return this.entries[this.range];
  }

  select(range: TokenRange) {
    this.range = range;
    this.refresh();
  }

  refresh() {
    const entry = this.entries[this.range];
    if (!window.bonfire || entry.loading) return;
    entry.loading = true;
    window.bonfire.tokens
      .get(this.range)
      .then((stats) => {
        entry.stats = stats;
        entry.error = undefined;
      })
      .catch((cause) => {
        entry.error = cause instanceof Error ? cause.message : String(cause);
      })
      .finally(() => (entry.loading = false));
  }
}

export const tokens = new TokenStore();

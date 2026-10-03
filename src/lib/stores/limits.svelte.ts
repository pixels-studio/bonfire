import type { AssistantProvider, ProviderLimits } from '$shared/contracts';
import { preferences } from './preferences.svelte';

type Entry = { limits?: ProviderLimits; error?: string; loading: boolean };

/** Plan limits per provider. Earlier results stay on screen while a refresh runs. */
class LimitsStore {
  entries = $state<Record<AssistantProvider, Entry>>({
    claude: { loading: false },
    codex: { loading: false },
  });

  /** Re-reads the limits of every provider in use; each one settles on its own. */
  refresh() {
    if (!window.bonfire) return;
    for (const provider of preferences.enabledProviders) {
      const entry = this.entries[provider];
      if (entry.loading) continue;
      entry.loading = true;
      window.bonfire.limits
        .get(provider)
        .then((limits) => {
          entry.limits = limits;
          entry.error = undefined;
        })
        .catch((cause) => {
          entry.error = cause instanceof Error ? cause.message : String(cause);
        })
        .finally(() => (entry.loading = false));
    }
  }
}

export const limits = new LimitsStore();

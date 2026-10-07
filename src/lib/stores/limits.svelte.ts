import type { AssistantProvider, ProviderLimits } from '$shared/contracts';
import { preferences } from './preferences.svelte';

type Entry = { limits?: ProviderLimits; error?: string; loading: boolean };

/** Plan limits per provider. Earlier results stay on screen while a refresh runs. */
class LimitsStore {
  entries = $state<Record<AssistantProvider, Entry>>({
    claude: { loading: false },
    codex: { loading: false },
  });
  #running: Partial<Record<AssistantProvider, Promise<void>>> = {};
  #queued: Partial<Record<AssistantProvider, Promise<void>>> = {};

  /** Re-reads the limits of every provider in use, or just `only`; each settles on its own. */
  refresh(only?: AssistantProvider): Promise<void> {
    if (!window.bonfire) return Promise.resolve();
    const providers = preferences.enabledProviders.filter(
      (provider) => !only || provider === only,
    );
    return Promise.all(providers.map((provider) => this.#read(provider))).then(
      () => {},
    );
  }

  /** Asked during a read, it reads once more afterwards, as that read may predate the change. */
  #read(provider: AssistantProvider): Promise<void> {
    const running = this.#running[provider];
    if (running)
      return (this.#queued[provider] ??= running.then(() => {
        this.#queued[provider] = undefined;
        return this.#read(provider);
      }));
    const entry = this.entries[provider];
    entry.loading = true;
    const load = window.bonfire.limits
      .get(provider)
      .then((limits) => {
        entry.limits = limits;
        entry.error = undefined;
      })
      .catch((cause) => {
        entry.error = cause instanceof Error ? cause.message : String(cause);
      })
      .finally(() => {
        entry.loading = false;
        this.#running[provider] = undefined;
      });
    this.#running[provider] = load;
    return load;
  }
}

export const limits = new LimitsStore();

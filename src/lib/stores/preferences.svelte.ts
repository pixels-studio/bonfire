import { PROVIDERS } from '$lib/models';
import type { Preferences } from '$shared/contracts';
import { DEFAULT_PREFERENCES, errorMessage } from '$shared/domain';
import { toast } from './toast.svelte';

/** The user's settings. A change shows at once and is saved in the background. */
class PreferencesStore {
  current = $state<Preferences>({ ...DEFAULT_PREFERENCES });
  enabledProviders = $derived(
    PROVIDERS.filter((provider) => this.current.providers[provider]),
  );

  async load() {
    if (!window.bonfire) return;
    this.current = await window.bonfire.preferences.get();
  }

  /** Applies `patch` locally, then saves it; if saving fails, the saved settings come back. */
  async update(patch: Partial<Preferences>) {
    Object.assign(this.current, patch);
    try {
      await window.bonfire.preferences.update(patch);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
      await this.load();
    }
  }
}

export const preferences = new PreferencesStore();

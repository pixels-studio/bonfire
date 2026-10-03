import {
  DEFAULT_CONTEXT_WINDOWS,
  MODELS,
  PROVIDERS,
  type Model,
} from '$lib/models';
import type { AssistantProvider } from '$shared/contracts';

/** The models each provider offers: the built-in list until the provider reports its own. */
class ModelCatalog {
  #reported = $state<Partial<Record<AssistantProvider, Model[]>>>({});
  #requested = false;

  all = $derived(PROVIDERS.flatMap((provider) => this.for(provider)));

  for(provider: AssistantProvider) {
    return (
      this.#reported[provider] ??
      MODELS.filter((model) => model.provider === provider)
    );
  }

  find(value: string) {
    return this.all.find((model) => model.value === value);
  }

  /** Fetches each provider's list once; a provider that can't be reached keeps the built-in one. */
  load() {
    if (this.#requested || !window.bonfire) return;
    this.#requested = true;
    for (const provider of PROVIDERS)
      window.bonfire.assistant
        .models(provider)
        .then((options) => {
          if (!options.length) return;
          this.#reported[provider] = options.map(
            ({ value, label, contextWindow, supportsFast }) => ({
              value,
              label,
              provider,
              supportsFast,
              contextWindow:
                contextWindow ??
                MODELS.find((model) => model.value === value)?.contextWindow ??
                DEFAULT_CONTEXT_WINDOWS[provider],
            }),
          );
        })
        .catch(() => {});
  }
}

export const catalog = new ModelCatalog();

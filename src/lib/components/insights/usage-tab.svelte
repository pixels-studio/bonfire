<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';
  import { limits } from '$lib/stores/limits.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import type { AssistantProvider } from '$shared/contracts';
  import { PROVIDER_LABELS } from '$shared/domain';
  import LimitMeter from './limit-meter.svelte';
  import LimitMeterSkeleton from './limit-meter-skeleton.svelte';
  import { limitsPace } from './pace';
  import { refreshOnTurns } from './refresh-on-turns.svelte';

  /** Whether any agent is at work, so limits are worth checking on between turns. */
  let { working }: { working: boolean } = $props();

  /** Windows each provider usually reports, so the placeholder is about as tall as the result. */
  const SKELETON_ROWS: Record<AssistantProvider, number> = {
    claude: 3,
    codex: 1,
  };

  // Each provider at its own pace, as reading their limits costs very differently.
  for (const provider of ['claude', 'codex'] as const)
    refreshOnTurns(
      () => limits.refresh(provider),
      () => limitsPace(provider, limits.entries[provider].limits, working),
    );
</script>

<div class="divide-y divide-border">
  {#each preferences.enabledProviders as provider (provider)}
    {@const entry = limits.entries[provider]}
    <section
      class="flex flex-col gap-3 px-4 py-6"
      aria-label={PROVIDER_LABELS[provider]}
    >
      <div class="flex items-center gap-2">
        <Icon name={provider} />
        <h3 class="font-medium">{PROVIDER_LABELS[provider]}</h3>
        {#if entry.limits?.plan}
          <span
            class="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground capitalize"
          >
            {entry.limits.plan}
          </span>
        {/if}
      </div>
      {#if entry.limits}
        <div class="flex flex-col gap-6">
          {#each entry.limits.windows as window (window.id)}
            <LimitMeter {window} />
          {:else}
            <p class="text-muted-foreground">
              No limits reported for this plan.
            </p>
          {/each}
        </div>
      {:else if entry.error}
        <p class="text-muted-foreground">{entry.error}</p>
      {:else}
        <div aria-busy="true" class="flex flex-col gap-6">
          {#each { length: SKELETON_ROWS[provider] } as _, row (row)}
            <LimitMeterSkeleton />
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>

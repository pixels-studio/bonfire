<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Search from '@lucide/svelte/icons/search';
  import * as Popover from '$lib/components/ui/popover';
  import { Switch } from '$lib/components/ui/switch';
  import EffortSlider from './effort-slider.svelte';
  import { EFFORT_LEVELS } from '$lib/models';
  import { catalog } from '$lib/stores/models.svelte';
  import { cn } from '$lib/utils';
  import type { AssistantProvider, ReasoningEffort } from '$shared/contracts';

  let {
    provider,
    model,
    effort = $bindable(),
    fast = $bindable(),
    fastSupported,
    onmodel,
  }: {
    /** Whose models to offer. */
    provider: AssistantProvider;
    model: string;
    effort: ReasoningEffort;
    fast: boolean;
    /** Whether the chosen model can run in fast mode; the switch is hidden if not. */
    fastSupported: boolean;
    onmodel: (value: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let highlighted = $state(0);

  const models = $derived(catalog.for(provider));
  const matches = $derived(
    models.filter((item) =>
      item.label.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const selected = $derived(models.find((item) => item.value === model));
  const effortIndex = $derived(
    Math.max(
      0,
      EFFORT_LEVELS.findIndex((level) => level.value === effort),
    ),
  );
  const effortLabel = $derived(EFFORT_LEVELS[effortIndex].label);

  // Starts each time from the full list with the current model highlighted.
  $effect(() => {
    if (!open) return;
    query = '';
    highlighted = Math.max(
      0,
      models.findIndex((item) => item.value === model),
    );
  });

  function choose(value: string) {
    onmodel(value);
    open = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (!matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlighted = (highlighted + step + matches.length) % matches.length;
      document
        .getElementById(`model-option-${highlighted}`)
        ?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(matches[Math.min(highlighted, matches.length - 1)].value);
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    aria-label="Select model and thinking effort"
    class="flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  >
    <span>{selected?.label ?? 'Default'}</span>
    <span class="text-muted-foreground">{effortLabel}</span>
    <ChevronDown class="-ml-0.5 size-3.5 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content class="w-72 gap-0 p-1" align="start" side="top">
    <div class="flex items-center gap-2 px-2 pt-1 pb-2">
      <Search class="size-4 shrink-0 text-muted-foreground" />
      <input
        bind:value={query}
        oninput={() => (highlighted = 0)}
        {onkeydown}
        class="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
        placeholder="Search models"
        aria-label="Search models"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="-mx-1 h-px bg-border"></div>
    <div
      role="listbox"
      aria-label="Models"
      class="max-h-64 overflow-y-auto py-1"
    >
      {#each matches as item, index (item.value)}
        {@const current = item.value === model}
        <button
          type="button"
          role="option"
          id={`model-option-${index}`}
          aria-selected={current}
          class={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none',
            index === highlighted && 'bg-accent text-accent-foreground',
          )}
          onmousemove={() => (highlighted = index)}
          onclick={() => choose(item.value)}
        >
          <span class="min-w-0 flex-1 truncate">{item.label}</span>
          {#if current}
            <Check class="size-4 shrink-0" aria-hidden="true" />
          {/if}
        </button>
      {:else}
        <p class="px-2 py-1.5 text-muted-foreground">No models found</p>
      {/each}
    </div>
    <div class="-mx-1 h-px bg-border"></div>
    <div class="flex flex-col gap-2.5 px-2 pt-2.5 pb-2">
      <div class="flex items-center justify-between text-sm">
        <span>Thinking effort</span>
        <!-- The labels are stacked and the strip slides, so a change rolls up or down. -->
        <span class="h-5 overflow-hidden text-right text-muted-foreground">
          <span class="sr-only" aria-live="polite">{effortLabel}</span>
          <span
            class="flex flex-col items-end transition-transform duration-300 ease-out motion-reduce:transition-none"
            style:transform={`translateY(${-effortIndex * 1.25}rem)`}
            aria-hidden="true"
          >
            {#each EFFORT_LEVELS as level (level.value)}
              <span class="h-5 leading-5">{level.label}</span>
            {/each}
          </span>
        </span>
      </div>
      <EffortSlider bind:value={effort} />
    </div>
    {#if fastSupported}
      <div class="-mx-1 h-px bg-border"></div>
      <label
        class="flex items-center justify-between gap-3 px-2 pt-2 pb-1.5 text-sm"
      >
        <span>Fast</span>
        <Switch bind:checked={fast} aria-label="Fast mode" />
      </label>
    {/if}
  </Popover.Content>
</Popover.Root>

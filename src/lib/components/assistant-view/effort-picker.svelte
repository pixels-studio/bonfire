<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import * as Popover from '$lib/components/ui/popover';
  import { Slider } from '$lib/components/ui/slider';
  import { EFFORT_LEVELS } from '$lib/models';
  import type { ReasoningEffort } from '$shared/contracts';

  let { value = $bindable() }: { value: ReasoningEffort } = $props();

  const index = $derived(
    Math.max(
      0,
      EFFORT_LEVELS.findIndex((level) => level.value === value),
    ),
  );
  const label = $derived(EFFORT_LEVELS[index].label);
</script>

<Popover.Root>
  <Popover.Trigger class="flex items-center gap-0.5 text-sm">
    {label}<ChevronDown class="size-3.5" />
  </Popover.Trigger>
  <Popover.Content class="w-55 p-6" align="start" side="top">
    <p>Thinking effort · {label}</p>
    <div class="relative py-1">
      <Slider
        type="single"
        bind:value={() => index, (next) => (value = EFFORT_LEVELS[next].value)}
        min={0}
        max={EFFORT_LEVELS.length - 1}
        step={1}
      />
      <div
        class="pointer-events-none absolute inset-0 -mx-0.5 flex items-center justify-between"
        aria-hidden="true"
      >
        {#each EFFORT_LEVELS as level (level.value)}
          <span class="size-1 rounded-full bg-muted-foreground"></span>
        {/each}
      </div>
    </div>
  </Popover.Content>
</Popover.Root>

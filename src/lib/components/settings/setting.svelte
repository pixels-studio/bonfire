<script lang="ts" module>
  /** Ties a setting's control to its title and description for assistive technology. */
  export type SettingControlProps = {
    'aria-labelledby': string;
    'aria-describedby'?: string;
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';

  let {
    title,
    description,
    inline = false,
    control,
  }: {
    title: string;
    /** Shown in a tooltip from an info icon beside the title. */
    description?: string | Snippet;
    /** Puts a compact control, such as a switch, beside the text rather than below it. */
    inline?: boolean;
    control: Snippet<[SettingControlProps]>;
  } = $props();

  const id = $props.id();
  const titleId = `${id}-title`;
  const descriptionId = $derived(description ? `${id}-description` : undefined);
  const controlProps = $derived<SettingControlProps>({
    'aria-labelledby': titleId,
    'aria-describedby': descriptionId,
  });
</script>

{#snippet text()}
  {#if typeof description === 'string'}
    {description}
  {:else if description}
    {@render description()}
  {/if}
{/snippet}

<div
  class={inline
    ? 'flex items-center justify-between gap-6'
    : 'flex flex-col gap-2'}
>
  <div class="flex min-w-0 items-center gap-1.5 text-sm">
    <!-- Above a field, the label steps back so the value reads first. -->
    <span
      id={titleId}
      class={inline ? 'text-foreground' : 'text-muted-foreground'}
    >
      {title}
    </span>
    {#if description}
      <!-- Read out with the control; the icon is for sighted users. -->
      <span id={descriptionId} class="sr-only">{@render text()}</span>
      <Tooltip.Root>
        <Tooltip.Trigger
          class="rounded-sm text-foreground/35 transition-colors outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label={`About ${title}`}
        >
          <Icon name="info" class="size-3.5" />
        </Tooltip.Trigger>
        <Tooltip.Content class="max-w-64">
          <!-- One block, so mixed text and markup wrap as a paragraph. -->
          <span class="block text-pretty">{@render text()}</span>
        </Tooltip.Content>
      </Tooltip.Root>
    {/if}
  </div>
  {@render control(controlProps)}
</div>

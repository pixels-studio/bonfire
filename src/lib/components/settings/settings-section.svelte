<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/components/icon/icon.svelte';

  let {
    title,
    icon,
    actions,
    children,
  }: {
    title: string;
    /** A sprite icon shown before the title. */
    icon: string;
    /** Controls shown at the end of the title row. */
    actions?: Snippet;
    children: Snippet;
  } = $props();
  const id = $props.id();
</script>

<!-- The first section stands in for the pane header: its title sits where other panes' titles do (centered in a 54px row). -->
<section
  class="flex flex-col gap-6 px-4 py-6 first:pt-4.25"
  aria-labelledby={id}
>
  <div class="flex items-center justify-between gap-2">
    <h3
      {id}
      class="flex items-center gap-2 text-sm font-semibold text-foreground"
    >
      <Icon name={icon} class="text-muted-foreground" />
      {title}
    </h3>
    {@render actions?.()}
  </div>
  {@render children()}
</section>

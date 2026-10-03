<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/components/icon/icon.svelte';

  let {
    title,
    icon,
    children,
  }: {
    title: string;
    /** A sprite icon shown before the title. */
    icon: string;
    children: Snippet;
  } = $props();
  const id = $props.id();
</script>

<section class="flex flex-col gap-6 p-6" aria-labelledby={id}>
  <h3
    {id}
    class="flex items-center gap-2 text-sm font-semibold text-foreground"
  >
    <Icon name={icon} class="text-muted-foreground" />
    {title}
  </h3>
  {@render children()}
</section>

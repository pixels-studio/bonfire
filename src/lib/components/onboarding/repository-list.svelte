<script lang="ts">
  import { onMount } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import Icon from '$lib/components/icon/icon.svelte';
  import type { GithubRepository } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';
  import { cn } from '$lib/utils';

  let {
    selected = $bindable(),
    disabled = false,
  }: {
    /** The clone URL of the chosen repository. */
    selected?: string;
    disabled?: boolean;
  } = $props();

  let repositories = $state<GithubRepository[]>();
  let error = $state('');
  let query = $state('');

  const shown = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (repositories ?? []).filter((repository) => {
      const text =
        `${repository.fullName} ${repository.description ?? ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  });

  async function load() {
    error = '';
    repositories = undefined;
    try {
      repositories = await window.bonfire.github.repositories();
    } catch (cause) {
      error = errorMessage(cause);
    }
  }

  onMount(() => void load());
</script>

<div class="flex min-h-0 flex-col gap-3">
  <div class="relative">
    <Search
      class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      bind:value={query}
      class="h-9.5 pl-9"
      placeholder="Search your repositories"
      aria-label="Search your repositories"
      spellcheck={false}
      {disabled}
    />
  </div>
  <div
    class="h-56 overflow-y-auto overscroll-contain rounded-xl border border-border"
    role="listbox"
    aria-label="Repositories"
  >
    {#if error}
      <div
        class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground"
      >
        <span class="text-pretty">{error}</span>
        <Button variant="secondary" size="sm" onclick={load}>Try again</Button>
      </div>
    {:else if !repositories}
      <div class="flex flex-col" aria-label="Loading repositories">
        {#each { length: 6 }, index (index)}
          <div
            class="h-12 animate-pulse border-b border-border bg-muted/30"
          ></div>
        {/each}
      </div>
    {:else if !shown.length}
      <div
        class="grid h-full place-content-center px-6 text-center text-sm text-muted-foreground"
      >
        {repositories.length
          ? `No repositories match “${query.trim()}”`
          : 'This account has no repositories yet'}
      </div>
    {:else}
      <div class="flex flex-col divide-y divide-border">
        {#each shown as repository (repository.fullName)}
          {@const active = selected === repository.cloneUrl}
          <button
            type="button"
            role="option"
            aria-selected={active}
            {disabled}
            class={cn(
              'flex items-center gap-3 px-3 py-3 text-left outline-none hover:bg-secondary focus-visible:bg-secondary disabled:pointer-events-none',
              active && 'bg-secondary',
            )}
            onclick={() => (selected = repository.cloneUrl)}
          >
            {#if repository.avatarUrl}
              <img
                src={`${repository.avatarUrl}${repository.avatarUrl.includes('?') ? '&' : '?'}s=48`}
                alt=""
                class="size-6 shrink-0 rounded-full bg-muted"
                loading="lazy"
              />
            {:else}
              <span class="size-6 shrink-0 rounded-full bg-muted"></span>
            {/if}
            <span class="min-w-0 flex-1 truncate text-sm">
              {repository.fullName}
            </span>
            {#if repository.private}
              <Icon
                name="lock"
                class="size-4 shrink-0 text-muted-foreground"
                aria-label="Private"
              />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

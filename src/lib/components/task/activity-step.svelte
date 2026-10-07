<script lang="ts">
  import FileIcon from '$lib/components/file-tree/file-icon.svelte';
  import type { Change } from '$shared/contracts';
  import type { ActivityStep } from '$shared/domain';

  let {
    step,
    files,
    onviewChanges,
  }: {
    step: ActivityStep;
    /** The step's files, relative to the task's folder, each with its change if it has one now. */
    files: { path: string; change?: Change }[];
    onviewChanges: (path?: string) => void;
  } = $props();

  /** The agent's title for the step; what it was asked, until it writes one. */
  const title = $derived(step.activity?.title || step.prompt);

  /** A new file shows its name in green, as the diff pane does. */
  const isNew = (change?: Change) =>
    change?.index === '?' || change?.index === 'A';

  const FILE_ROW =
    'flex w-full items-center gap-2.5 rounded-lg bg-foreground/5 px-3 py-2 text-left text-sm';
</script>

{#snippet file(path: string, change?: Change)}
  {@const slash = path.lastIndexOf('/') + 1}
  <FileIcon name={path.slice(slash)} class="size-4 shrink-0" />
  <span class="min-w-0 flex-1 truncate">
    <span class={isNew(change) ? 'text-success' : 'text-foreground'}
      >{path.slice(slash)}</span
    >
    <span class="text-muted-foreground">{path.slice(0, slash)}</span>
  </span>
  {#if change?.additions}
    <span class="shrink-0 text-success tabular-nums">+{change.additions}</span>
  {/if}
  {#if change?.deletions}
    <span class="shrink-0 text-destructive tabular-nums"
      >-{change.deletions}</span
    >
  {/if}
{/snippet}

<article class="flex flex-col gap-3">
  <!-- Title and summary share one style; only the summary's color is muted. -->
  <div class="flex flex-col gap-1 text-sm leading-relaxed">
    <h4 class="line-clamp-2 text-foreground">{title}</h4>
    {#if step.activity?.body}
      <p class="whitespace-pre-wrap text-pretty text-muted-foreground">
        {step.activity.body}
      </p>
    {/if}
  </div>

  {#if files.length}
    <ul class="mt-1 flex flex-col gap-1.5" aria-label="Files changed">
      {#each files as { path, change } (path)}
        <li>
          {#if change}
            <button
              type="button"
              class="{FILE_ROW} cursor-pointer outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/60"
              title={`View changes to ${path}`}
              onclick={() => onviewChanges(path)}
            >
              {@render file(path, change)}
            </button>
          {:else}
            <!-- Touched, but with no change now, such as one since committed: no diff to open. -->
            <div
              class="{FILE_ROW} opacity-60"
              title={`${path} has no uncommitted changes`}
            >
              {@render file(path)}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</article>

<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { buttonVariants } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { scripts } from '$lib/stores/scripts.svelte';
  import { cn } from '$lib/utils';
  import type { RunScript } from '$shared/contracts';
  import ScriptDialog from './script-dialog.svelte';

  let menuOpen = $state(false);
  let dialogOpen = $state(false);
  /** The script the dialog edits; unset when it adds one. */
  let editing = $state<RunScript>();

  const list = $derived(scripts.list);
  const selected = $derived(scripts.selected);
  /** How many scripts run now; while any do, the button stops them all. */
  const runningCount = $derived(scripts.running.length);
  const running = $derived(runningCount > 0);
  const pending = $derived(
    running
      ? scripts.running.some(({ id }) => scripts.pending[id])
      : !!selected && !!scripts.pending[selected.id],
  );

  /** The pill's two halves sit a pixel apart, so the header shows through as a cutout. Their facing borders are dropped, as the button's transparent border would widen the gap. */
  const HALF_CLASS = cn(
    buttonVariants({ variant: 'secondary', size: 'sm' }),
    'text-foreground',
  );

  function openDialog(script?: RunScript) {
    editing = script;
    menuOpen = false;
    // Lets the menu hand focus back before the dialog takes it.
    requestAnimationFrame(() => (dialogOpen = true));
  }

  /** Stops every running script, or runs the selected one; with no scripts yet, asks for one. */
  function primary() {
    if (running) return void scripts.stopAll();
    if (!selected) return openDialog();
    void scripts.run(selected.id);
  }

  function toggle(script: RunScript) {
    if (scripts.isRunning(script.id)) void scripts.stop(script.id);
    else void scripts.run(script.id);
  }

  const label = $derived.by(() => {
    if (running) return 'Stop';
    if (!selected || (list?.length ?? 0) < 2) return 'Run';
    return selected.name;
  });

  const title = $derived.by(() => {
    if (running)
      return `Stop ${scripts.running.map(({ name }) => name).join(', ')}`;
    if (!selected) return 'Add a script that starts the project';
    return `Run ${selected.name}: ${selected.command}`;
  });
</script>

<div class="flex items-center gap-px" role="group" aria-label="Run scripts">
  <button
    type="button"
    class={cn(
      HALF_CLASS,
      'relative max-w-44 min-w-20 rounded-r-none border-r-0 pr-3 pl-2.5',
      pending && 'disabled:opacity-100',
    )}
    disabled={list === undefined || pending}
    aria-busy={pending || undefined}
    {title}
    onclick={primary}
  >
    <span
      class={cn('flex min-w-0 items-center gap-1.5', pending && 'invisible')}
    >
      {#if running}
        <Icon name="stop" class="size-2.5 text-destructive" />
      {:else}
        <Icon name="play" class="size-3" />
      {/if}
      <span class="truncate">{label}</span>
      {#if runningCount > 1}
        <span
          class="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-foreground/15 px-1 text-[0.65rem] leading-none font-semibold tabular-nums"
          aria-label={`${runningCount} running`}
        >
          {runningCount}
        </span>
      {/if}
    </span>
    {#if pending}
      <span class="absolute inset-0 grid place-items-center" aria-hidden="true">
        <span
          class="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current motion-reduce:animate-pulse"
        ></span>
      </span>
    {/if}
  </button>
  <DropdownMenu.Root bind:open={menuOpen}>
    <DropdownMenu.Trigger
      class={cn(HALF_CLASS, 'rounded-l-none border-l-0 pr-2 pl-1.5')}
      disabled={list === undefined}
      aria-label="Run scripts"
      title="Run scripts"
    >
      <ChevronDown class="size-3.5 text-muted-foreground" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-76">
      <DropdownMenu.Label>Run scripts</DropdownMenu.Label>
      {#each list ?? [] as script (script.id)}
        {@const isRunning = scripts.isRunning(script.id)}
        <DropdownMenu.Item
          class="gap-2.5"
          title={isRunning ? `Stop ${script.name}` : script.command}
          disabled={!!scripts.pending[script.id]}
          onclick={() => toggle(script)}
        >
          <span class="grid size-4 shrink-0 place-items-center">
            {#if isRunning}
              <Icon name="stop" class="size-3 text-destructive" />
            {:else}
              <Icon name="play" class="size-3.5 text-muted-foreground" />
            {/if}
          </span>
          <span class="flex min-w-0 flex-1 items-center gap-1.5">
            <span class="truncate">{script.name}</span>
            {#if isRunning}
              <span
                class="dot-working size-1.5 shrink-0 rounded-full bg-success"
                aria-label="Running"
              ></span>
            {/if}
          </span>
          {#if (list?.length ?? 0) > 1 && script.id === selected?.id}
            <Icon
              name="check"
              class="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Run button starts this"
            />
          {/if}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class="-my-0.5 -mr-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
                  aria-label={`Actions for ${script.name}`}
                  onclick={(event) => event.stopPropagation()}
                >
                  <Icon name="dots" class="size-4" />
                </button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="w-32">
              <DropdownMenu.Item onclick={() => openDialog(script)}>
                <Icon name="edit" /> Edit
              </DropdownMenu.Item>
              <DropdownMenu.Item
                variant="destructive"
                onclick={() => {
                  menuOpen = false;
                  void scripts.remove(script.id);
                }}
              >
                <Icon name="trash" /> Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </DropdownMenu.Item>
      {:else}
        <p class="px-1.5 pt-1 pb-2 text-xs text-pretty text-muted-foreground">
          No start script found in this project. Add one to run it from here.
        </p>
      {/each}
      <DropdownMenu.Separator />
      <DropdownMenu.Item class="gap-2" onclick={() => openDialog()}>
        <Icon name="plus" class="size-4" /> Add script
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

<ScriptDialog bind:open={dialogOpen} script={editing} />

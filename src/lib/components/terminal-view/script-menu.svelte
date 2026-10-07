<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button, buttonVariants } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { scripts } from '$lib/stores/scripts.svelte';
  import { cn } from '$lib/utils';
  import type { RunScript } from '$shared/contracts';
  import ScriptDialog from './script-dialog.svelte';

  // A Run button (Stop while scripts run) with the script list behind its chevron, for the header.
  let menuOpen = $state(false);
  let dialogOpen = $state(false);
  /** The script the dialog edits; unset when it adds one. */
  let editing = $state<RunScript>();

  const list = $derived(scripts.list);
  const runningCount = $derived(scripts.running.length);

  function openDialog(script?: RunScript) {
    editing = script;
    menuOpen = false;
    // Lets the menu hand focus back before the dialog takes it.
    requestAnimationFrame(() => (dialogOpen = true));
  }

  // The run shortcut and button ask for a script through this dialog when the project has none.
  $effect(() => {
    scripts.onNeedScript = () => openDialog();
    return () => (scripts.onNeedScript = undefined);
  });

  function toggle(script: RunScript) {
    if (scripts.isRunning(script.id)) void scripts.stop(script.id);
    else void scripts.run(script.id);
  }
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <div class="flex items-center gap-px">
    <Button
      variant="secondary"
      class="gap-1.5 rounded-r-sm pr-3 leading-4 text-foreground"
      disabled={list === undefined}
      onclick={() => scripts.toggle()}
    >
      {#if runningCount}
        <Icon name="stop" class="size-3 text-destructive" />
        Stop
      {:else}
        <Icon name="play" class="size-3" />
        Run
      {/if}
    </Button>
    <DropdownMenu.Trigger
      class={cn(
        buttonVariants({ variant: 'secondary', size: 'icon' }),
        'h-full w-9 rounded-l-sm text-muted-foreground hover:text-foreground',
      )}
      disabled={list === undefined}
      aria-label="Scripts"
    >
      <ChevronDown class="size-4" />
    </DropdownMenu.Trigger>
  </div>
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
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex items-center gap-1.5">
            <span class="truncate">{script.name}</span>
            {#if isRunning}
              <span
                class="dot-working size-1.5 shrink-0 rounded-full bg-success"
                aria-label="Running"
              ></span>
            {/if}
          </span>
          <span class="truncate font-mono text-xs text-muted-foreground">
            {script.command}
          </span>
        </span>
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

<ScriptDialog bind:open={dialogOpen} script={editing} />

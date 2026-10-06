<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import { overlayScrollbar } from '$lib/scrollbar';
  import { paneIcon } from '$lib/panes';
  import type { ShortcutId } from '$lib/shortcuts';
  import { scripts } from '$lib/stores/scripts.svelte';
  import { PROVIDER_LABELS } from '$shared/domain';
  import type { AssistantProvider, Pane, PaneType } from '$shared/contracts';
  import ScriptDialog from '../terminal-view/script-dialog.svelte';

  let {
    title,
    subtitle,
    providers,
    startingProvider,
    canAddTerminal = true,
    disabled = false,
    openViews = [],
    closedPanes = [],
    onadd,
    onrestore,
  }: {
    title: string;
    subtitle: string;
    /** The agents that are turned on, in the order they are offered. */
    providers: AssistantProvider[];
    /** The agent ⌘N opens; ⇧⌘N opens the other one. */
    startingProvider: AssistantProvider;
    canAddTerminal?: boolean;
    disabled?: boolean;
    /** The view panes already open, which a click brings into sight rather than adds. */
    openViews?: PaneType[];
    /** The workspace's closed panes that can be reopened, most recently closed first. */
    closedPanes?: Pane[];
    onadd: (type: PaneType) => void;
    onrestore?: (id: string) => void;
  } = $props();

  type Choice = {
    type: PaneType;
    label: string;
    hint: string;
    shortcut: ShortcutId;
    disabled?: boolean;
  };

  const agents = $derived<Choice[]>(
    providers.map((provider) => ({
      type: provider,
      label: PROVIDER_LABELS[provider],
      hint: 'Agent',
      shortcut:
        provider === startingProvider ? 'newConversation' : 'newOtherAgent',
    })),
  );

  const tools = $derived<Choice[]>([
    {
      type: 'files',
      label: 'Project tree',
      hint: 'Browse and open files',
      shortcut: 'newFiles',
    },
    {
      type: 'diff',
      label: 'Git changes',
      hint: 'Diff, push, pull request, merge',
      shortcut: 'newDiff',
    },
    {
      type: 'browser',
      label: 'Browser',
      hint: 'Preview the running app',
      shortcut: 'newBrowser',
    },
    {
      type: 'terminal',
      label: 'Terminal',
      hint: 'Shell, and your run scripts',
      shortcut: 'newTerminal',
      disabled: !canAddTerminal,
    },
  ]);

  const SECTION_LABEL = 'px-1 pb-1.5 text-xs font-medium text-muted-foreground';
  const ROW_CLASS =
    'group flex w-full items-center gap-3 rounded-lg bg-secondary px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50';

  let dialogOpen = $state(false);

  // The run shortcut asks for a script through the same dialog when the project has none.
  $effect(() => {
    scripts.onNeedScript = () => (dialogOpen = true);
    return () => (scripts.onNeedScript = undefined);
  });
</script>

{#snippet choiceRow(choice: Choice)}
  {@const open = openViews.includes(choice.type)}
  <button
    type="button"
    class={ROW_CLASS}
    disabled={disabled || choice.disabled}
    onclick={() => onadd(choice.type)}
  >
    <Icon
      name={choice.type === 'files' || choice.type === 'diff'
        ? paneIcon(choice.type)
        : choice.type}
      class="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
    />
    <span class="min-w-0 flex-1">
      <span class="block truncate">{choice.label}</span>
      <span class="block truncate text-xs text-muted-foreground">
        {choice.hint}
      </span>
    </span>
    {#if open}
      <span class="shrink-0 text-xs text-muted-foreground">Open</span>
    {:else}
      <ShortcutKeys id={choice.shortcut} />
    {/if}
  </button>
{/snippet}

<Card.Root class="h-full min-w-0 gap-0 p-0" role="region" aria-label="New pane">
  <div
    {@attach overlayScrollbar}
    class="min-h-0 flex-1 overflow-y-auto px-5 py-8"
  >
    <div class="mx-auto flex w-full max-w-72 flex-col gap-6">
      <header class="text-center">
        <h2 class="font-medium text-pretty text-foreground">{title}</h2>
        <p class="mt-1 text-sm text-pretty text-muted-foreground">
          {subtitle}
        </p>
      </header>

      {#if agents.length}
        <section>
          <h3 class={SECTION_LABEL}>Agents</h3>
          <div class="grid gap-1.5">
            {#each agents as choice (choice.type)}
              {@render choiceRow(choice)}
            {/each}
          </div>
        </section>
      {/if}

      <section>
        <h3 class={SECTION_LABEL}>Project</h3>
        <div class="grid gap-1.5">
          {#each tools as choice (choice.type)}
            {@render choiceRow(choice)}
          {/each}
        </div>
      </section>

      {#if closedPanes.length && onrestore}
        <section>
          <h3 class={SECTION_LABEL}>Recently closed</h3>
          <div class="grid gap-0.5">
            {#each closedPanes.slice(0, 4) as pane (pane.id)}
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                {disabled}
                onclick={() => onrestore(pane.id)}
              >
                <Icon name={paneIcon(pane.type)} class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">{pane.title}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
</Card.Root>

<ScriptDialog bind:open={dialogOpen} />

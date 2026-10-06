<script lang="ts" module>
  import type { WorkspaceStatus } from '$shared/contracts';
  import type { ShortcutId } from '$lib/shortcuts';

  /** A view that opens over the workspace from the sidebar's footer. */
  export type RailPanel = 'insights' | 'settings' | 'shortcuts';

  const PANEL_ITEMS: {
    panel: RailPanel;
    icon: string;
    label: string;
    shortcut: ShortcutId;
  }[] = [
    {
      panel: 'insights',
      icon: 'insights',
      label: 'Insights',
      shortcut: 'insights',
    },
    {
      panel: 'settings',
      icon: 'settings',
      label: 'Settings',
      shortcut: 'settings',
    },
    {
      panel: 'shortcuts',
      icon: 'keyboard',
      label: 'Keyboard shortcuts',
      shortcut: 'shortcuts',
    },
  ];

  const SECTIONS: { status: WorkspaceStatus; label: string }[] = [
    { status: 'in_progress', label: 'In progress' },
    { status: 'done', label: 'Done' },
    { status: 'archived', label: 'Closed' },
  ];

  const ACTIVITY_DOTS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'bg-success dot-working',
    input: 'bg-orange-400',
    error: 'bg-destructive',
    done: 'bg-yellow-400',
  };
  const ACTIVITY_LABELS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'An agent is working',
    input: 'An agent is waiting for you',
    error: 'An agent failed',
    done: 'An agent finished',
  };
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import SidebarControls from './sidebar-controls.svelte';
  import ProjectPicker from '$lib/components/workspace/project-picker.svelte';
  import type { PaneStatus, ProjectAttention } from '$lib/pane-status.svelte';
  import { cliVersions } from '$lib/stores/cli-versions.svelte';
  import { cn } from '$lib/utils';
  import { CLI_NAMES } from '$shared/domain';
  import { workspaceLabel } from '$shared/domain';
  import type { Project, Workspace } from '$shared/contracts';

  let {
    projects,
    project,
    attention = {},
    projectMenuOpen = $bindable(false),
    workspaces,
    currentId,
    activity = {},
    creating = false,
    settingsOpen = false,
    trafficLightInset = false,
    panel,
    onpanel,
    onhelp,
    oncollapse,
    onprevious,
    onnext,
    onselectProject,
    onaddProject,
    onremoveProject,
    onsettings,
    oncreate,
    onopen,
    onrename,
    onarchive,
    onunarchive,
    ondelete,
  }: {
    projects: Project[];
    project?: Project;
    /** What needs the user in each other project, which the picker flags. */
    attention?: Record<string, ProjectAttention>;
    projectMenuOpen?: boolean;
    /** The project's workspaces, its main one among them. */
    workspaces: Workspace[];
    currentId?: string;
    /** What each workspace's agents are doing, by workspace id; idle ones are left out. */
    activity?: Record<string, PaneStatus>;
    /** A workspace is being made, which takes a moment. */
    creating?: boolean;
    /** Whether the project's settings are open. */
    settingsOpen?: boolean;
    /** Keeps the project picker clear of the native window controls. */
    trafficLightInset?: boolean;
    /** The panel open over the workspace, if any. */
    panel?: RailPanel;
    onpanel: (panel: RailPanel) => void;
    onhelp: () => void;
    /** Hides the sidebar. */
    oncollapse: () => void;
    /** Opens the project before or after the open one. */
    onprevious: () => void;
    onnext: () => void;
    onselectProject: (id: string) => void;
    onaddProject: () => void;
    onremoveProject: (id: string) => void;
    onsettings: () => void;
    oncreate: () => void;
    onopen: (id: string) => void;
    onrename: (id: string, title: string) => void;
    onarchive: (id: string) => void;
    onunarchive: (id: string) => void;
    ondelete: (id: string) => void;
  } = $props();

  /** Newest first in each section, as the latest work is the likeliest to be picked. */
  const sections = $derived(
    SECTIONS.map((section) => ({
      ...section,
      items: workspaces
        .filter((item) => !item.main && item.status === section.status)
        .toSorted((a, b) => b.createdAt - a.createdAt),
    })),
  );

  let renamingId = $state<string>();
  let draft = $state('');
  let deleting = $state<Workspace>();

  function startRename(workspace: Workspace) {
    draft = workspaceLabel(workspace);
    renamingId = workspace.id;
  }

  function finishRename(save: boolean) {
    const id = renamingId;
    renamingId = undefined;
    const title = draft.trim();
    const workspace = workspaces.find((item) => item.id === id);
    if (save && id && title && workspace && title !== workspaceLabel(workspace))
      onrename(id, title);
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  const FOOTER_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';

  /** The CLIs the update button would update, such as `Claude Code and Codex`. */
  const updateNames = $derived(
    [
      ...new Set(
        cliVersions.outdated.map(({ provider }) => CLI_NAMES[provider]),
      ),
    ].join(' and '),
  );

  const ROW_CLASS =
    'group/row relative flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60';
</script>

{#snippet marker(workspace: Workspace)}
  {@const status = activity[workspace.id]}
  {@const active = status && status !== 'idle'}
  <span class="grid size-4 shrink-0 place-content-center">
    <!-- Green: working. Orange: waiting for you. Yellow: finished, not yet seen. Gray: quiet. -->
    <span
      class={cn(
        'size-2 rounded-full',
        active ? ACTIVITY_DOTS[status] : 'bg-muted-foreground/40',
      )}
      role="img"
      aria-label={active ? ACTIVITY_LABELS[status] : 'Idle'}
      title={active ? ACTIVITY_LABELS[status] : 'Idle'}
    ></span>
  </span>
{/snippet}

{#snippet row(workspace: Workspace)}
  {@const current = workspace.id === currentId}
  {@const label = workspaceLabel(workspace)}
  <li class="relative">
    {#if renamingId === workspace.id}
      <div class={cn(ROW_CLASS, 'bg-secondary')}>
        {@render marker(workspace)}
        <input
          class="-my-0.5 h-6 min-w-0 flex-1 rounded-md bg-background px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Workspace title"
          maxlength={200}
          spellcheck="false"
          autocomplete="off"
          bind:value={draft}
          use:focusAndSelect
          onkeydown={(event) => {
            if (event.key === 'Enter') finishRename(true);
            else if (event.key === 'Escape') {
              event.stopPropagation();
              finishRename(false);
            }
          }}
          onblur={() => finishRename(true)}
        />
      </div>
    {:else}
      <button
        type="button"
        class={cn(
          ROW_CLASS,
          'pr-8',
          current
            ? 'bg-secondary text-foreground'
            : 'text-foreground/85 hover:bg-secondary/60',
          workspace.status === 'archived' &&
            !current &&
            'text-muted-foreground',
        )}
        aria-current={current ? 'page' : undefined}
        onclick={() => onopen(workspace.id)}
        ondblclick={() => startRename(workspace)}
      >
        {@render marker(workspace)}
        <span class="truncate">{label}</span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 aria-expanded:opacity-100 [li:hover_&]:opacity-100"
              aria-label={`Actions for ${label}`}
            >
              <Icon name="dots" class="size-4" />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" side="right" class="w-44">
          <DropdownMenu.Item onclick={() => startRename(workspace)}>
            <Icon name="edit" /> Rename
          </DropdownMenu.Item>
          {#if workspace.status === 'archived'}
            <DropdownMenu.Item onclick={() => onunarchive(workspace.id)}>
              <Icon name="revert" /> Unarchive
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              onclick={() => (deleting = workspace)}
            >
              <Icon name="trash" /> Delete…
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item onclick={() => onarchive(workspace.id)}>
              <Icon name="close-panes" /> Archive
            </DropdownMenu.Item>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </li>
{/snippet}

<aside class="flex w-72 shrink-0 flex-col pb-2" aria-label="Workspaces">
  <!-- The window buttons sit at the left in a window; the sidebar button makes room for them. -->
  <div
    class={cn(
      'flex h-13 shrink-0 items-center gap-1 px-4 app-drag',
      trafficLightInset && 'pl-20!',
    )}
  >
    <SidebarControls
      canSwitch={projects.length > 1}
      ontoggle={oncollapse}
      {onprevious}
      {onnext}
    />
  </div>
  <div class="flex shrink-0 items-center gap-1.5 px-4 pb-2 app-drag">
    <!-- One rounded-md control. The picker's trigger spans all of it, so its menu does too; the
         settings button sits over the trigger's right end. -->
    <div class="relative min-w-0 flex-1 rounded-md bg-secondary app-no-drag">
      <ProjectPicker
        {projects}
        active={project}
        {attention}
        bind:open={projectMenuOpen}
        onselect={onselectProject}
        onadd={onaddProject}
        onremove={onremoveProject}
        class={cn('h-9 w-full max-w-none rounded-md', project && 'pr-10')}
      />
      {#if project}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant={settingsOpen ? 'default' : 'ghost'}
                size="icon-sm"
                class={cn(
                  'absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-md',
                  !settingsOpen &&
                    'text-muted-foreground hover:text-foreground',
                )}
                aria-label="Project options"
                title="Project options"
              >
                <Icon name="dots" />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="w-48">
            <DropdownMenu.Item onclick={onsettings}>
              <Icon name="settings" /> Settings
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              onclick={() => onremoveProject(project.id)}
            >
              <Icon name="trash" /> Remove project
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
  </div>

  {#if project}
    <nav
      class="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 scrollbar-none"
    >
      {#each sections as section (section.status)}
        {#if section.items.length || section.status === 'in_progress'}
          <section class="shrink-0">
            <div class="flex items-center justify-between pr-1 pb-1">
              <h3 class="px-2 text-xs font-medium text-muted-foreground">
                {section.label}
              </h3>
              {#if section.status === 'in_progress'}
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-sm"
                        class="size-6 text-muted-foreground hover:text-foreground"
                        aria-label="New workspace"
                        loading={creating}
                        disabled={creating}
                        onclick={oncreate}
                      >
                        <Icon name="plus" />
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content side="bottom">
                    {creating ? 'Making a workspace…' : 'New workspace'}
                    <ShortcutKeys id="newWorkspace" />
                  </Tooltip.Content>
                </Tooltip.Root>
              {/if}
            </div>
            <ul class="flex flex-col gap-0.5">
              {#each section.items as workspace (workspace.id)}
                {@render row(workspace)}
              {/each}
            </ul>
          </section>
        {/if}
      {/each}
    </nav>
  {/if}
  <footer
    class="flex shrink-0 items-center justify-between px-4 pt-2"
    aria-label="App"
  >
    {#each PANEL_ITEMS as item (item.panel)}
      {@const pressed = panel === item.panel}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={pressed ? 'default' : 'ghost'}
              size="icon-sm"
              class={cn(!pressed && FOOTER_BUTTON_CLASS)}
              aria-label={item.label}
              aria-pressed={pressed}
              onclick={() => onpanel(item.panel)}
            >
              <Icon name={item.icon} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">
          {item.label}
          <ShortcutKeys id={item.shortcut} inverse />
        </Tooltip.Content>
      </Tooltip.Root>
    {/each}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon-sm"
            class={FOOTER_BUTTON_CLASS}
            aria-label="Help"
            onclick={onhelp}
          >
            <Icon name="help" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Help</Tooltip.Content>
    </Tooltip.Root>
    {#if cliVersions.outdated.length}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              size="icon-sm"
              aria-label={`Update ${updateNames}`}
              loading={cliVersions.updating}
              disabled={cliVersions.updating}
              onclick={() => cliVersions.update()}
            >
              <Icon name="update" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">
          <div class="flex flex-col gap-0.5">
            <span>
              {cliVersions.updating
                ? `Updating ${updateNames}…`
                : `Update ${updateNames} to use Bonfire`}
            </span>
            {#each cliVersions.outdated as version (`${version.provider}:${version.machineId}`)}
              <span class="opacity-70">
                {CLI_NAMES[version.provider]} on {version.machineName}: {version.installed},
                needs {version.required}
              </span>
            {/each}
          </div>
        </Tooltip.Content>
      </Tooltip.Root>
    {/if}
  </footer>
</aside>

<Dialog.Root
  open={!!deleting}
  onOpenChange={(open) => {
    if (!open) deleting = undefined;
  }}
>
  <Dialog.Content class="w-[min(28rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="text-lg font-semibold">
        Delete {deleting ? workspaceLabel(deleting) : 'workspace'}?
      </Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <Dialog.Description class="text-sm text-pretty text-muted-foreground">
        Its branch <span class="font-mono text-foreground"
          >{deleting?.branch}</span
        >, any work saved when it was archived, and its conversations are
        deleted for good. Work already pushed stays on the remote.
      </Dialog.Description>
    </Dialog.Body>
    <Dialog.Footer>
      <Button
        variant="secondary"
        class="min-w-20"
        onclick={() => (deleting = undefined)}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        class="min-w-20"
        onclick={() => {
          if (deleting) ondelete(deleting.id);
          deleting = undefined;
        }}
      >
        Delete
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

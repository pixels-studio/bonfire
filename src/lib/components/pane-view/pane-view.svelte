<script lang="ts">
  import BrowserView from '$lib/components/browser-view/browser-view.svelte';
  import AssistantView from '$lib/components/assistant-view/assistant-view.svelte';
  import DiffView from '$lib/components/diff-view/diff-view.svelte';
  import FilesView from '$lib/components/files-view/files-view.svelte';
  import TerminalView from '$lib/components/terminal-view/terminal-view.svelte';
  import type { PaneProps } from '$lib/panes';
  import type { PaneBadge } from '$lib/pane-status.svelte';
  import { isAssistantPane } from '$shared/domain';
  import type { Pane } from '$shared/contracts';

  let {
    pane,
    workspaceId,
    badge,
    onnavigate,
    onviewChanges,
    selectedDiff,
    ...props
  }: PaneProps & {
    pane: Pane;
    workspaceId: string;
    /** An agent's status worth flagging on its icon. */
    badge?: PaneBadge;
    /** A browser pane moved to another page. */
    onnavigate: (url: string) => void;
    /** Opens or focuses the project's code diff pane from an agent's file card. */
    onviewChanges: (path?: string) => void;
    selectedDiff?: { path: string; request: number };
  } = $props();
</script>

{#if isAssistantPane(pane)}
  <AssistantView
    {pane}
    provider={pane.type}
    {badge}
    {onviewChanges}
    {...props}
  />
{:else if pane.type === 'files'}
  <FilesView {workspaceId} title={pane.title} {...props} />
{:else if pane.type === 'diff'}
  <DiffView {workspaceId} title={pane.title} {selectedDiff} {...props} />
{:else if pane.type === 'browser'}
  <BrowserView title={pane.title} url={pane.url} {onnavigate} {...props} />
{:else}
  <TerminalView
    {workspaceId}
    paneId={pane.id}
    scriptId={pane.scriptId}
    title={pane.title}
    {...props}
  />
{/if}

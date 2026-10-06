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
    projectId,
    badge,
    onnavigate,
    ...props
  }: PaneProps & {
    pane: Pane;
    projectId: string;
    /** An agent's status worth flagging on its icon. */
    badge?: PaneBadge;
    /** A browser pane moved to another page. */
    onnavigate: (url: string) => void;
  } = $props();
</script>

{#if isAssistantPane(pane)}
  <AssistantView {pane} provider={pane.type} {badge} {...props} />
{:else if pane.type === 'files'}
  <FilesView {projectId} title={pane.title} {...props} />
{:else if pane.type === 'diff'}
  <DiffView {projectId} title={pane.title} {...props} />
{:else if pane.type === 'browser'}
  <BrowserView title={pane.title} url={pane.url} {onnavigate} {...props} />
{:else}
  <TerminalView
    {projectId}
    paneId={pane.id}
    scriptId={pane.scriptId}
    title={pane.title}
    {...props}
  />
{/if}

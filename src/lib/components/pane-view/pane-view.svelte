<script lang="ts">
  import AssistantView from '$lib/components/assistant-view/assistant-view.svelte';
  import DiffView from '$lib/components/diff-view/diff-view.svelte';
  import FilesView from '$lib/components/files-view/files-view.svelte';
  import TerminalView from '$lib/components/terminal-view/terminal-view.svelte';
  import type { PaneProps } from '$lib/panes';
  import { isAssistantPane } from '$shared/domain';
  import type { Pane } from '$shared/contracts';

  let {
    pane,
    projectId,
    ...props
  }: PaneProps & { pane: Pane; projectId: string } = $props();
</script>

{#if isAssistantPane(pane)}
  <AssistantView {pane} provider={pane.type} {...props} />
{:else if pane.type === 'files'}
  <FilesView {projectId} title={pane.title} {...props} />
{:else if pane.type === 'diff'}
  <DiffView {projectId} title={pane.title} {...props} />
{:else}
  <TerminalView {projectId} paneId={pane.id} title={pane.title} {...props} />
{/if}

import { randomUUID } from 'node:crypto';
import type {
  AssistantEvent,
  AssistantProvider,
  Pane,
  PaneType,
} from '../../../shared/contracts';
import {
  DEFAULT_TITLE,
  MAX_PANES,
  MAX_TERMINAL_PANES,
  TOOL_PANE_TITLES,
  isAssistantPane,
  isReopenable,
  isViewPaneType,
  otherProvider,
  startingProvider,
} from '../../../shared/domain';
import { forkSummaryPrompt } from '../fork-summary';
import type { Store } from '../persistence';
import type { Scripts } from '../scripts';
import type { Terminals } from '../terminal';
import type { Agents } from './agents';
import type { PaneView, WorkspaceView } from '../state';

type PaneOptions = {
  store: Store;
  agents: Agents;
  terminals: Terminals;
  /** Called on use, as scripts open panes through this service too. */
  scripts: () => Scripts;
  emit: (event: AssistantEvent) => void;
};

/** Opening, closing, arranging and forking a workspace's panes. */
export function paneService({
  store,
  agents,
  terminals,
  scripts,
  emit,
}: PaneOptions) {
  const openPanesOf = (workspace: WorkspaceView) =>
    store.state.panes.filter(
      (pane) => pane.workspaceId === workspace.id && !pane.archived,
    );

  /** The workspace's open view pane of the type; there is at most one, and never of other types. */
  const openViewOf = (workspace: WorkspaceView, type: PaneType) =>
    isViewPaneType(type)
      ? openPanesOf(workspace).find((pane) => pane.type === type)
      : undefined;

  /** Throws unless the workspace is open and has room for another pane of the type. */
  function requireRoom(workspace: WorkspaceView, type?: PaneType) {
    if (workspace.status === 'archived')
      throw Error('Unarchive the workspace to open panes in it.');
    const open = openPanesOf(workspace);
    if (open.length >= MAX_PANES)
      throw new Error(`A workspace can have up to ${MAX_PANES} panes open.`);
    if (
      type === 'terminal' &&
      open.filter((pane) => pane.type === 'terminal').length >=
        MAX_TERMINAL_PANES
    )
      throw new Error(
        `A workspace can have up to ${MAX_TERMINAL_PANES} terminal panes open.`,
      );
  }

  /** The provider and model new panes start with: the chosen default, else the last used. */
  function startingModel() {
    const { defaultModel } = store.preferences;
    const { lastProvider, lastModels } = store.state.settings;
    const provider = startingProvider(store.preferences, lastProvider);
    if (defaultModel?.provider === provider) return defaultModel;
    return { provider, model: lastModels?.[provider] ?? '' };
  }

  function modelFor(
    provider: AssistantProvider,
    starting: ReturnType<typeof startingModel>,
  ) {
    if (provider === starting.provider) return starting.model;
    return store.state.settings.lastModels?.[provider] ?? '';
  }

  /**
   * Adds a pane to the workspace on screen, at the front unless placed at the end; agents
   * start with the last-used provider and model. A view pane always goes at the end, and
   * only once: an open one is returned as it is.
   */
  function add(
    type?: PaneType,
    workspace = store.currentWorkspace(),
    other = false,
    at: 'front' | 'end' = 'front',
  ) {
    if (!workspace) throw Error('Add a project first.');
    const view = type && isViewPaneType(type);
    const open = type && openViewOf(workspace, type);
    if (open) return open;
    requireRoom(workspace, type);
    const starting = startingModel();
    const paneType =
      type ??
      (other
        ? otherProvider(starting.provider, store.preferences.providers)
        : starting.provider);
    const agent = paneType === 'claude' || paneType === 'codex';
    if (agent) agents.requireEnabled(paneType);
    return store.panes.add(
      {
        id: randomUUID(),
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        type: paneType,
        title: agent ? DEFAULT_TITLE : TOOL_PANE_TITLES[paneType],
        messages: [],
        model: agent ? modelFor(paneType, starting) : '',
        reasoningEffort: store.state.settings.lastReasoningEffort ?? 'medium',
        fastMode: false,
        approvals: store.preferences.approvals,
        archived: false,
      },
      view ? 'end' : at,
    );
  }

  function archive(pane: PaneView) {
    // An archived pane has no view left to show, answer its turn, or type into its shell.
    agents.discard(pane);
    terminals.closePane(pane.id);
    scripts().forgetPane(pane.id);
    store.panes.archive(pane);
  }

  /**
   * Reopens a closed pane where `add` would put a new one of its kind, under the same
   * limits. A view pane of a kind already open stays closed, and the open one is returned.
   */
  function restore(pane: PaneView) {
    if (!pane.archived) return pane;
    if (!isReopenable(pane))
      throw Error('Run the script again to see its output.');
    if (!pane.workspaceId) throw Error('This pane has no project to open in.');
    const workspace = store.workspace(pane.workspaceId);
    const open = openViewOf(workspace, pane.type);
    if (open) return open;
    requireRoom(workspace, pane.type);
    if (isAssistantPane(pane)) agents.requireEnabled(pane.type);
    store.panes.restore(pane, isViewPaneType(pane.type) ? 'end' : 'front');
    return pane;
  }

  /** Starts a pane with another agent from a summary of the conversation up to a reply. */
  async function fork(
    paneId: string,
    messageId: string,
    provider: AssistantProvider,
  ) {
    agents.requireEnabled(provider);
    const pane = store.pane(paneId);
    if (!pane.workspaceId) throw Error('Select a project first.');
    const index = pane.messages.findIndex(
      (message) => message.id === messageId,
    );
    if (index === -1) throw Error('That reply is no longer available.');
    const summary = (
      await agents.generateText(
        forkSummaryPrompt(pane.messages.slice(0, index + 1)),
      )
    ).trim();
    if (!summary) throw Error('Could not summarize this conversation.');
    const forked = add(provider, store.workspace(pane.workspaceId));
    const attachment = await agents.call(
      'attachText',
      forked.id,
      summary,
      `Summary from ${pane.title}`,
    );
    return { pane: forked, attachment };
  }

  function rename(id: string, title: string) {
    const pane = store.pane(id);
    store.panes.update(pane, { title });
    // Agent panes keep their title in the view, which follows title events.
    if (isAssistantPane(pane)) emit({ paneId: id, type: 'title', title });
  }

  function navigate(id: string, url: string) {
    const pane = store.pane(id);
    if (pane.type !== 'browser')
      throw Error('Only a browser pane opens pages.');
    if (pane.url !== url) store.panes.update(pane, { url });
  }

  return {
    openPanesOf,
    add,
    archive,
    restore,
    fork,
    rename,
    navigate,
    reorder: (ids: string[]) => store.panes.reorder(ids),
  };
}

export type Panes = ReturnType<typeof paneService>;

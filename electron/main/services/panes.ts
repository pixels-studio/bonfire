import { randomUUID } from 'node:crypto';
import type {
  AssistantEvent,
  AssistantProvider,
  Pane,
  PaneType,
  Project,
} from '../../../shared/contracts';
import {
  DEFAULT_TITLE,
  MAX_PANES,
  MAX_TERMINAL_PANES,
  TOOL_PANE_TITLES,
  isAssistantPane,
  isViewPaneType,
  otherProvider,
  startingProvider,
} from '../../../shared/domain';
import { forkSummaryPrompt } from '../fork-summary';
import type { Store } from '../persistence';
import type { Scripts } from '../scripts';
import type { Terminals } from '../terminal';
import type { Agents } from './agents';
import type { PaneView, ProjectView } from '../state';

type PaneOptions = {
  store: Store;
  agents: Agents;
  terminals: Terminals;
  /** Called on use, as scripts open panes through this service too. */
  scripts: () => Scripts;
  emit: (event: AssistantEvent) => void;
};

/** Opening, closing, arranging and forking a project's panes. */
export function paneService({
  store,
  agents,
  terminals,
  scripts,
  emit,
}: PaneOptions) {
  const openPanesOf = (project: ProjectView) =>
    store.state.panes.filter(
      (pane) => pane.projectId === project.id && !pane.archived,
    );

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
   * Adds a pane to the project on screen, at the front unless placed at the end; agents
   * start with the last-used provider and model. A view pane always goes at the end, and
   * only once: an open one is returned as it is.
   */
  function add(
    type?: PaneType,
    project = store.state.lastProjectId
      ? store.project(store.state.lastProjectId)
      : undefined,
    other = false,
    at: 'front' | 'end' = 'front',
  ) {
    if (!project) throw Error('Add a project first.');
    const view = type && isViewPaneType(type);
    const open = view
      ? openPanesOf(project).find((pane) => pane.type === type)
      : undefined;
    if (open) return open;
    if (openPanesOf(project).length >= MAX_PANES)
      throw new Error(`A project can have up to ${MAX_PANES} panes open.`);
    if (
      type === 'terminal' &&
      openPanesOf(project).filter((pane) => pane.type === 'terminal').length >=
        MAX_TERMINAL_PANES
    )
      throw new Error(
        `A project can have up to ${MAX_TERMINAL_PANES} terminal panes open.`,
      );
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
        projectId: project.id,
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

  /** Starts a pane with another agent from a summary of the conversation up to a reply. */
  async function fork(
    paneId: string,
    messageId: string,
    provider: AssistantProvider,
  ) {
    agents.requireEnabled(provider);
    const pane = store.pane(paneId);
    if (!pane.projectId) throw Error('Select a project first.');
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
    const forked = add(provider, store.project(pane.projectId));
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

  return {
    openPanesOf,
    add,
    archive,
    fork,
    rename,
    reorder: (ids: string[]) => store.panes.reorder(ids),
  };
}

export type Panes = ReturnType<typeof paneService>;

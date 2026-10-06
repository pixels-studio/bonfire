import type {
  AssistantProvider,
  Pane,
  Preferences,
  Project,
  ReasoningEffort,
  SshConnection,
  State,
} from '../../shared/contracts';
import { resolvePreferences } from '../../shared/domain';
import type { AgentStore } from './assistant';
import {
  appendToMessage,
  assign,
  putMessage,
  type PanePatch,
  type PaneView,
  sendable,
  type StateView,
} from './state';

/** What the agent host is told of the state: everything but conversations and closed panes. */
export type AgentState = {
  projects: Project[];
  connections: SshConnection[];
  preferences: Partial<Preferences>;
  /** Open panes, without their messages. */
  panes: Omit<Pane, 'messages'>[];
};

/** A change the agent host made, for main to make in the Store. */
export type AgentChange =
  | { seq: number; kind: 'pane'; paneId: string; patch: PanePatch }
  | {
      seq: number;
      kind: 'turn';
      provider: AssistantProvider;
      model: string;
      reasoningEffort: ReasoningEffort;
    }
  | { seq: number; kind: 'save'; paneId?: string };

/** The panes main lists, without their messages, from the state it holds; sent as a copy. */
export function agentState(view: StateView): AgentState {
  const state = sendable<State>(view);
  return {
    projects: [...state.projects],
    connections: [...state.connections],
    preferences: state.preferences,
    panes: state.panes
      .filter((pane) => !pane.archived)
      .map(({ messages: _, ...pane }) => pane),
  };
}

/**
 * The agent host's copy of the state, which the assistants read and change as they would
 * the Store. Main owns the state: it sends a fresh copy after each change, and the changes
 * made here go back to it. A copy that left before one of those changes reached main is
 * behind it, so changes main hasn't confirmed are made again on top.
 *
 * Messages are the exception. Main has every conversation; here a pane holds only what its
 * turns stream, which reaches main through the events the window gets too, and which is
 * let go once the turn is over.
 */
export class AgentMirror implements AgentStore {
  private projects = new Map<string, Project>();
  private readonly paneMap = new Map<string, Pane>();
  private stored: Partial<Preferences> = {};
  connections: SshConnection[] = [];
  readonly panes: AgentStore['panes'];
  readonly settings: AgentStore['settings'];
  private seq = 0;
  /** Changes sent but not yet in a copy from main. */
  private unconfirmed: Extract<AgentChange, { kind: 'pane' }>[] = [];

  constructor(private readonly send: (change: AgentChange) => void) {
    this.panes = {
      update: (pane, patch) => {
        const change = {
          seq: ++this.seq,
          kind: 'pane' as const,
          paneId: pane.id,
          patch,
        };
        this.unconfirmed.push(change);
        assign(pane, patch);
        this.send(change);
      },
      putMessage,
      append: appendToMessage,
    };
    this.settings = {
      rememberTurn: (provider, model, reasoningEffort) =>
        this.send({
          seq: ++this.seq,
          kind: 'turn',
          provider,
          model,
          reasoningEffort,
        }),
    };
  }

  /** Takes main's copy of the state, which has every change up to `applied` made. */
  sync(state: AgentState, applied: number) {
    this.projects = new Map(
      state.projects.map((project) => [project.id, project]),
    );
    // Unchanged connections keep their objects, by which the host's machines are cached.
    const known = new Map(this.connections.map((item) => [item.id, item]));
    this.connections = state.connections.map((item) => {
      const kept = known.get(item.id);
      return kept && JSON.stringify(kept) === JSON.stringify(item)
        ? kept
        : item;
    });
    this.stored = state.preferences;
    const listed = new Set<string>();
    for (const fields of state.panes) {
      listed.add(fields.id);
      const pane = this.paneMap.get(fields.id);
      // A pane keeps its object, which a running turn holds, and its streamed messages.
      if (pane) {
        for (const key of Object.keys(pane) as (keyof Pane)[])
          if (key !== 'messages' && !(key in fields)) delete pane[key];
        Object.assign(pane, fields);
      } else this.paneMap.set(fields.id, { ...fields, messages: [] });
    }
    for (const id of this.paneMap.keys())
      if (!listed.has(id)) this.paneMap.delete(id);
    this.unconfirmed = this.unconfirmed.filter(({ seq }) => seq > applied);
    for (const { paneId, patch } of this.unconfirmed) {
      const pane = this.paneMap.get(paneId);
      if (pane) assign(pane, patch);
    }
  }

  /** Main has made every change up to `applied`; they no longer need making again. */
  confirm(applied: number) {
    this.unconfirmed = this.unconfirmed.filter(({ seq }) => seq > applied);
  }

  get preferences(): Preferences {
    return resolvePreferences(this.stored);
  }

  project(id: string) {
    const project = this.projects.get(id);
    if (!project) throw Error('Project not found');
    return project;
  }

  pane(id: string) {
    const pane = this.paneMap.get(id);
    if (!pane) throw Error('Pane not found');
    return pane;
  }

  save(pane?: PaneView) {
    this.send({ seq: ++this.seq, kind: 'save', paneId: pane?.id });
  }

  /** The turn is over and main has everything it streamed. */
  release(pane: PaneView) {
    // The host's copy is its own to change.
    const own = this.paneMap.get(pane.id);
    if (own) own.messages = [];
  }
}

import { z } from 'zod';

export const id = z.string().uuid();
export const paneType = z.enum(['claude', 'codex', 'terminal']);
export const assistantProvider = z.enum(['claude', 'codex']);
export const reasoningEffort = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export const conversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  kind: z.enum(['text', 'thinking', 'tool', 'attachment', 'error']),
  text: z.string(),
  status: z.enum(['streaming', 'complete', 'failed']).default('complete'),
  size: z.number().int().nonnegative().optional(),
  previewUrl: z.string().optional(),
});

export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
});

export const attachmentSchema = z.object({
  id,
  name: z.string(),
  size: z.number().int().nonnegative(),
  previewUrl: z.string(),
});

export const paneSchema = z.object({
  id,
  sessionId: id,
  type: paneType,
  title: z.string(),
  threadId: z.string().optional(),
  messages: z.array(conversationMessageSchema).default([]),
  usage: usageSchema.optional(),
  model: z.string().default(''),
  reasoningEffort: reasoningEffort.default('medium'),
  archived: z.boolean().default(false),
});

export const sessionSchema = z.object({
  id,
  projectId: id,
  title: z.string(),
  branch: z.string().optional(),
  worktreePath: z.string(),
  createdAt: z.number(),
  lastOpenedAt: z.number(),
  layout: z.object({ paneIds: z.array(id), activePaneId: id.optional() }),
});

export const projectSchema = z.object({
  id,
  name: z.string(),
  path: z.string(),
  createdAt: z.number(),
  lastOpenedAt: z.number(),
});

export const stateSchema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema),
  sessions: z.array(sessionSchema),
  panes: z.array(paneSchema),
  lastProjectId: id.optional(),
  lastSessionId: id.optional(),
  settings: z.object({
    lastProvider: assistantProvider.optional(),
    lastModels: z
      .object({ claude: z.string(), codex: z.string() })
      .partial()
      .optional(),
  }),
});

const filePath = z.string().max(4096);

export const assistantSendInput = z.object({
  paneId: id,
  text: z.string().trim().min(1).max(100_000),
  attachmentIds: z.array(id).max(8).default([]),
  model: z.string().max(100),
  reasoningEffort,
});

export const terminalCreateInput = z.object({
  sessionId: id,
  paneId: id,
  type: z.enum(['claude', 'codex', 'shell']),
});

export type Project = z.infer<typeof projectSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Pane = z.infer<typeof paneSchema>;
export type PaneType = z.infer<typeof paneType>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type AssistantProvider = z.infer<typeof assistantProvider>;
export type ReasoningEffort = z.infer<typeof reasoningEffort>;
export type AssistantSendInput = z.infer<typeof assistantSendInput>;
export type TerminalCreateInput = z.infer<typeof terminalCreateInput>;
export type State = z.infer<typeof stateSchema>;
export type AssistantEvent =
  | { paneId: string; type: 'message'; message: ConversationMessage }
  | { paneId: string; type: 'usage'; usage: Usage }
  | {
      paneId: string;
      type: 'status';
      status: 'running' | 'idle' | 'failed';
      error?: string;
    };
export type Change = { path: string; index: string; worktree: string };
export type GitStatus = { isGit: boolean; branch: string; changes: Change[] };
export type Entry = { name: string; directory: boolean };
export type TerminalSnapshot = {
  data: string;
  sequence: number;
  exitCode?: number;
};
export type TerminalEvent = {
  terminalId: string;
  sequence: number;
  data?: string;
  exitCode?: number;
};
export type FileChangeEvent = { sessionId: string; path: string };

/** IPC argument schemas, keyed by `group.method`. Every channel is validated in main. */
export const requests = {
  'state.get': z.tuple([]),
  'projects.add': z.tuple([]),
  'projects.remove': z.tuple([id]),
  'projects.select': z.tuple([id]),
  'projects.favicon': z.tuple([id]),
  'sessions.create': z.tuple([
    z.object({ projectId: id, title: z.string().trim().min(1).max(120) }),
  ]),
  'sessions.select': z.tuple([id]),
  'panes.add': z.tuple([
    id,
    paneType.optional(),
    z.string().max(100).optional(),
  ]),
  'panes.retype': z.tuple([id, assistantProvider, z.string().max(100)]),
  'panes.archive': z.tuple([id]),
  'assistant.send': z.tuple([assistantSendInput]),
  'assistant.pickAttachment': z.tuple([id]),
  'assistant.cancel': z.tuple([id]),
  'navigation.help': z.tuple([]),
  'app.isFullscreen': z.tuple([]),
  'terminal.create': z.tuple([terminalCreateInput]),
  'terminal.write': z.tuple([id, z.string().max(1_048_576)]),
  'terminal.resize': z.tuple([
    id,
    z.number().int().min(2).max(500),
    z.number().int().min(1).max(300),
  ]),
  'terminal.snapshot': z.tuple([id]),
  'git.status': z.tuple([id]),
  'git.branches': z.tuple([id]),
  'git.diff': z.tuple([id, filePath]),
  'git.checkout': z.tuple([id, z.string().trim().min(1).max(200)]),
  'filesystem.list': z.tuple([id, filePath]),
  'filesystem.readFile': z.tuple([id, filePath]),
  'filesystem.watch': z.tuple([id]),
  'filesystem.unwatch': z.tuple([id]),
};

/** Push channels from main to the renderer. */
export const events = {
  terminalData: 'terminal:data',
  assistantEvent: 'assistant:event',
  fileChange: 'filesystem:change',
  fullscreen: 'window:fullscreen',
} as const;

type Unsubscribe = () => void;

export type API = {
  state: { get(): Promise<State> };
  projects: {
    add(): Promise<Project | null>;
    remove(id: string): Promise<void>;
    select(id: string): Promise<void>;
    favicon(id: string): Promise<string | null>;
  };
  sessions: {
    create(input: { projectId: string; title: string }): Promise<Session>;
    select(id: string): Promise<void>;
  };
  panes: {
    add(sessionId: string, type?: PaneType, model?: string): Promise<Pane>;
    retype(id: string, type: AssistantProvider, model: string): Promise<Pane>;
    archive(id: string): Promise<void>;
  };
  assistant: {
    send(input: AssistantSendInput): Promise<void>;
    pickAttachment(paneId: string): Promise<Attachment | null>;
    cancel(paneId: string): Promise<void>;
    onEvent(listener: (event: AssistantEvent) => void): Unsubscribe;
  };
  navigation: { help(): Promise<void> };
  app: {
    isFullscreen(): Promise<boolean>;
    onFullscreenChange(listener: (fullscreen: boolean) => void): Unsubscribe;
  };
  terminal: {
    create(input: TerminalCreateInput): Promise<string>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    snapshot(id: string): Promise<TerminalSnapshot>;
    onData(listener: (event: TerminalEvent) => void): Unsubscribe;
  };
  git: {
    status(sessionId: string): Promise<GitStatus>;
    branches(projectId: string): Promise<string[]>;
    diff(sessionId: string, path: string): Promise<string>;
    checkout(sessionId: string, branch: string): Promise<void>;
  };
  filesystem: {
    list(sessionId: string, path: string): Promise<Entry[]>;
    readFile(sessionId: string, path: string): Promise<string>;
    watch(sessionId: string): Promise<void>;
    unwatch(sessionId: string): Promise<void>;
    onChange(listener: (event: FileChangeEvent) => void): Unsubscribe;
  };
};

/** The request/response half of the API that main implements (no push subscriptions). */
export type Backend = {
  [Group in keyof API]: {
    [
      Method in keyof API[Group] as Method extends `on${string}`
        ? never
        : Method
    ]: API[Group][Method];
  };
};

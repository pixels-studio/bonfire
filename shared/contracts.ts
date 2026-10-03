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
  /** Structured details for tool-call messages. */
  tool: z
    .object({
      name: z.string(),
      /** The call's key argument, such as a shell command or file path. */
      input: z.string().default(''),
      output: z.string().default(''),
    })
    .optional(),
});

export const approvalMode = z.enum(['ask', 'auto']);
/** What a message sent while the agent is running does: wait for the turn to end, or join it. */
export const followUpMode = z.enum(['queue', 'steer']);
export const codexPersonality = z.enum([
  'default',
  'friendly',
  'pragmatic',
  'none',
]);
export const modelChoice = z.object({
  provider: assistantProvider,
  model: z.string().min(1).max(100),
});

/** Settings the user chooses. Stored sparsely, so unset fields follow `DEFAULT_PREFERENCES`. */
export const preferencesSchema = z.object({
  /** Model for new panes; `null` reuses the last model sent with. */
  defaultModel: modelChoice.nullable(),
  /** Whether new panes ask before running tools. */
  approvals: approvalMode,
  followUp: followUpMode,
  /** Model that names conversations. */
  textModel: modelChoice,
  /** Pasted text longer than `LONG_TEXT_THRESHOLD` becomes an attachment. */
  convertLongText: z.boolean(),
  /** OKLCH hue of the accent color, in degrees. */
  accentHue: z.number().min(0).max(360),
  notifications: z.boolean(),
  completionSound: z.boolean(),
  providers: z.object({ claude: z.boolean(), codex: z.boolean() }),
  claudeOutputStyle: z.string().min(1).max(100),
  codexPersonality,
  /** Archives a pane once the pull request for its branch is merged, through the `gh` CLI. */
  archiveOnMerge: z.boolean(),
  /** Keeps the system awake while a turn runs. */
  caffeinate: z.boolean(),
});

/**
 * What currently occupies the context window after the latest model call. The four
 * counts are disjoint, so their sum is the context size.
 */
export const usageSchema = z.object({
  /** Input tokens that were not served from cache. */
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  /** Output tokens excluding reasoning. */
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  /** The window size when the provider reports one. */
  contextWindow: z.number().int().positive().optional(),
});

export const attachmentSchema = z.object({
  id,
  name: z.string(),
  size: z.number().int().nonnegative(),
  /** Images only; text attachments have no preview. */
  previewUrl: z.string().optional(),
});

export const paneSchema = z.object({
  id,
  /** Unset until a project is chosen; locked once the conversation starts. */
  sessionId: id.optional(),
  type: paneType,
  title: z.string(),
  threadId: z.string().optional(),
  messages: z.array(conversationMessageSchema).default([]),
  usage: usageSchema.optional(),
  model: z.string().default(''),
  reasoningEffort: reasoningEffort.default('medium'),
  /** Panes from before permissions were configurable ran unattended. */
  approvals: approvalMode.default('auto'),
  /** The branch the conversation last worked on, and since when, to spot its pull request merging. */
  workBranch: z.object({ name: z.string(), since: z.number() }).optional(),
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
  layout: z.object({ paneIds: z.array(id) }),
  /** Default project for new panes. */
  lastProjectId: id.optional(),
  settings: z.object({
    lastProvider: assistantProvider.optional(),
    lastModels: z
      .object({ claude: z.string(), codex: z.string() })
      .partial()
      .optional(),
  }),
  preferences: preferencesSchema.partial().default({}),
});

const filePath = z.string().max(4096);
/** The longest text, in characters, that can be attached. */
export const MAX_TEXT_ATTACHMENT_LENGTH = 1_000_000;

export const assistantSendInput = z.object({
  paneId: id,
  text: z.string().trim().min(1).max(100_000),
  attachmentIds: z.array(id).max(8).default([]),
  model: z.string().max(100),
  reasoningEffort,
  approvals: approvalMode,
  /** How to deliver the message if a turn is already running; without it the send is refused. */
  followUp: followUpMode.optional(),
});

export const assistantRespondInput = z.object({
  paneId: id,
  requestId: z.string().max(200),
  /** Answer to an approval request. */
  decision: z.enum(['allow', 'allow-session', 'deny']).optional(),
  /** Answers to a question request, keyed by question id. */
  answers: z
    .record(z.string(), z.array(z.string().max(10_000)).max(20))
    .optional(),
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
export type AssistantRespondInput = z.infer<typeof assistantRespondInput>;
export type ApprovalMode = z.infer<typeof approvalMode>;
export type TerminalCreateInput = z.infer<typeof terminalCreateInput>;
export type State = z.infer<typeof stateSchema>;
export type FollowUpMode = z.infer<typeof followUpMode>;
export type CodexPersonality = z.infer<typeof codexPersonality>;
export type ModelChoice = z.infer<typeof modelChoice>;
export type Preferences = z.infer<typeof preferencesSchema>;
/** A message waiting for the running turn to end. */
export type QueuedPrompt = { id: string; text: string; attachments: number };
/** The signed-in account of a provider's CLI. */
export type ProviderAccount = {
  provider: AssistantProvider;
  signedIn: boolean;
  email?: string;
  plan?: string;
};
export type GithubStatus =
  { installed: false } | { installed: true; login?: string };
/** A GitHub device-flow sign-in waiting for the user to enter the code. */
export type GithubSignIn = { userCode: string; verificationUrl: string };
/** How a GitHub sign-in ended: the account gh now uses, and why it failed if it did. */
export type GithubSignInEnd = { status: GithubStatus; error?: string };
export type Question = {
  id: string;
  header: string;
  question: string;
  options: { label: string; description?: string }[];
  multiple: boolean;
};
/** Something the assistant is waiting on the user for. */
export type AssistantRequest =
  | {
      id: string;
      kind: 'approval';
      title: string;
      /** The command, file, or other target the approval covers. */
      detail: string;
      reason?: string;
      /** Whether the provider can remember the approval for the rest of the session. */
      canRemember: boolean;
    }
  | { id: string; kind: 'question'; questions: Question[] };
export type AssistantEvent =
  | { paneId: string; type: 'message'; message: ConversationMessage }
  /** Text appended to a streaming message's `text` or a tool message's `tool.output`. */
  | {
      paneId: string;
      type: 'delta';
      id: string;
      field: 'text' | 'output';
      text: string;
    }
  | { paneId: string; type: 'usage'; usage: Usage }
  /**
   * A turn reports `running`, then `completed` or `failed` unless it was stopped, then `idle`.
   */
  | {
      paneId: string;
      type: 'status';
      status: 'running' | 'completed' | 'failed' | 'idle';
    }
  | { paneId: string; type: 'request'; request: AssistantRequest }
  | { paneId: string; type: 'request-resolved'; requestId: string }
  | { paneId: string; type: 'queue'; queue: QueuedPrompt[] }
  | { paneId: string; type: 'title'; title: string };
/** The main process's live view of a pane, for a renderer that missed events. */
export type AssistantSnapshot = {
  running: boolean;
  messages: ConversationMessage[];
  usage?: Usage;
  requests: AssistantRequest[];
  queue: QueuedPrompt[];
};
export type ModelOption = {
  value: string;
  label: string;
  contextWindow?: number;
};
/** One rate-limit window of a provider's plan, such as the weekly limit. */
export type LimitWindow = {
  id: string;
  label: string;
  /** Share of the window already used, 0-100. */
  usedPercent: number;
  /** When the window resets, in milliseconds since the epoch. */
  resetsAt?: number;
};
export type ProviderLimits = {
  provider: AssistantProvider;
  /** Subscription plan, such as "max" or "pro". */
  plan?: string;
  windows: LimitWindow[];
};
export const tokenRange = z.enum(['today', '7d', '30d']);
export type TokenRange = z.infer<typeof tokenRange>;
/** One line of a token breakdown: a model, or a day. */
export type TokenRow = {
  /** The model name, or the day as `YYYY-MM-DD`. */
  key: string;
  provider?: AssistantProvider;
  tokens: number;
  /** USD; null when no price is known. */
  cost: number | null;
};
export type TokenStats = {
  range: TokenRange;
  totals: {
    /** Every token sent or produced, including those written to the cache. */
    processed: number;
    cachedInput: number;
    /** Input that was neither read from nor written to the cache. */
    uncachedInput: number;
    output: number;
    /** USD saved by reading input from cache instead of paying the full input price. */
    cacheSavings: number;
  };
  /** Processed tokens per provider and bucket: one per hour for today, one per day otherwise. `at` is in milliseconds. */
  series: ({ at: number } & Record<AssistantProvider, number>)[];
  models: TokenRow[];
  days: TokenRow[];
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
/** Panes the app archived on its own, such as when their pull request merged. */
export type PanesClosedEvent = { paneIds: string[]; reason: 'merged' };

/** IPC argument schemas, keyed by `group.method`. Every channel is validated in main. */
export const requests = {
  'state.get': z.tuple([]),
  'preferences.get': z.tuple([]),
  'preferences.update': z.tuple([preferencesSchema.partial()]),
  'providers.account': z.tuple([assistantProvider]),
  'providers.connect': z.tuple([assistantProvider]),
  'providers.cancelConnect': z.tuple([assistantProvider]),
  'providers.outputStyles': z.tuple([]),
  'github.status': z.tuple([]),
  'github.connect': z.tuple([]),
  'github.cancelConnect': z.tuple([]),
  'projects.add': z.tuple([]),
  'projects.remove': z.tuple([id]),
  'projects.favicon': z.tuple([id]),
  'sessions.create': z.tuple([
    z.object({ projectId: id, title: z.string().trim().min(1).max(120) }),
  ]),
  'panes.add': z.tuple([paneType.optional(), z.string().max(100).optional()]),
  'panes.setProject': z.tuple([id, id]),
  'panes.retype': z.tuple([id, assistantProvider, z.string().max(100)]),
  'panes.archive': z.tuple([id]),
  'panes.reorder': z.tuple([z.array(id).max(100)]),
  'assistant.send': z.tuple([assistantSendInput]),
  'assistant.pickAttachment': z.tuple([id]),
  'assistant.attachText': z.tuple([
    id,
    z.string().min(1).max(MAX_TEXT_ATTACHMENT_LENGTH),
  ]),
  'assistant.sendQueued': z.tuple([id, id]),
  'assistant.unqueue': z.tuple([id, id]),
  'assistant.cancel': z.tuple([id]),
  'assistant.respond': z.tuple([assistantRespondInput]),
  'assistant.snapshot': z.tuple([id]),
  'assistant.models': z.tuple([assistantProvider]),
  'limits.get': z.tuple([assistantProvider]),
  'tokens.get': z.tuple([tokenRange]),
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
  focusPane: 'window:focus-pane',
  notificationsBlocked: 'window:notifications-blocked',
  panesClosed: 'panes:closed',
  githubSignInEnd: 'github:sign-in-end',
} as const;

type Unsubscribe = () => void;

export type API = {
  state: { get(): Promise<State> };
  preferences: {
    get(): Promise<Preferences>;
    /** Saves the given fields and returns the full, resolved preferences. */
    update(patch: Partial<Preferences>): Promise<Preferences>;
  };
  providers: {
    account(provider: AssistantProvider): Promise<ProviderAccount>;
    /** Signs in through the browser, replacing the current account; resolves once done. */
    connect(provider: AssistantProvider): Promise<ProviderAccount>;
    cancelConnect(provider: AssistantProvider): Promise<void>;
    /** Output styles Claude offers, built-in and the user's own. */
    outputStyles(): Promise<string[]>;
  };
  github: {
    status(): Promise<GithubStatus>;
    /**
     * Starts a device-flow sign-in; how it ends arrives through `onSignInEnd`. Signing in
     * as another account adds it to gh and makes it the active one.
     */
    connect(): Promise<GithubSignIn>;
    cancelConnect(): Promise<void>;
    onSignInEnd(listener: (end: GithubSignInEnd) => void): Unsubscribe;
  };
  projects: {
    add(): Promise<Project | null>;
    remove(id: string): Promise<void>;
    favicon(id: string): Promise<string | null>;
  };
  sessions: {
    create(input: { projectId: string; title: string }): Promise<Session>;
  };
  panes: {
    add(type?: PaneType, model?: string): Promise<Pane>;
    onClosed(listener: (event: PanesClosedEvent) => void): Unsubscribe;
    setProject(id: string, projectId: string): Promise<Pane>;
    retype(id: string, type: AssistantProvider, model: string): Promise<Pane>;
    archive(id: string): Promise<void>;
    /** Reorders the given panes among the layout slots they already occupy. */
    reorder(ids: string[]): Promise<void>;
  };
  assistant: {
    send(input: AssistantSendInput): Promise<void>;
    pickAttachment(paneId: string): Promise<Attachment | null>;
    attachText(paneId: string, text: string): Promise<Attachment>;
    /** Sends a queued message now: it steers the running turn, or starts one. */
    sendQueued(paneId: string, queuedId: string): Promise<void>;
    unqueue(paneId: string, queuedId: string): Promise<void>;
    cancel(paneId: string): Promise<void>;
    respond(input: AssistantRespondInput): Promise<void>;
    snapshot(paneId: string): Promise<AssistantSnapshot>;
    models(provider: AssistantProvider): Promise<ModelOption[]>;
    onEvent(listener: (event: AssistantEvent) => void): Unsubscribe;
  };
  limits: {
    /** Plan limits for a provider; rejects when signed out or on an API key. */
    get(provider: AssistantProvider): Promise<ProviderLimits>;
  };
  tokens: {
    /** Token usage read from the Claude and Codex session logs on this machine. */
    get(range: TokenRange): Promise<TokenStats>;
  };
  navigation: { help(): Promise<void> };
  app: {
    isFullscreen(): Promise<boolean>;
    onFullscreenChange(listener: (fullscreen: boolean) => void): Unsubscribe;
    /** A notification for a pane was clicked. */
    onFocusPane(listener: (paneId: string) => void): Unsubscribe;
    /** The OS refused a notification; carries the app name to allow in its settings. */
    onNotificationsBlocked(listener: (appName: string) => void): Unsubscribe;
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

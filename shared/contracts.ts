import { z } from 'zod';

export const id = z.string().uuid();
export const assistantProvider = z.enum(['claude', 'codex']);
/** Panes that show the project itself rather than talk to an agent. */
export const toolPaneType = z.enum(['files', 'terminal', 'diff', 'browser']);
export const paneType = z.enum([
  ...assistantProvider.options,
  ...toolPaneType.options,
]);
/** A page a browser pane can show: web pages only, never files or app URLs. */
export const browserUrl = z
  .string()
  .max(2048)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'Only web pages can be opened.',
  );
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
  kind: z.enum([
    'text',
    'thinking',
    'tool',
    'attachment',
    'error',
    /** Like `error`, but the provider reported its model was overloaded or rate-limited. */
    'capacity',
    'notice',
  ]),
  text: z.string(),
  status: z.enum(['streaming', 'complete', 'failed']).default('complete'),
  size: z.number().int().nonnegative().optional(),
  previewUrl: z.string().optional(),
  /** How long a thinking or text message took to stream, once complete. */
  durationMs: z.number().int().nonnegative().optional(),
  /** When a thinking or text message finished streaming, once complete. */
  createdAt: z.number().int().nonnegative().optional(),
  /** Structured details for tool-call messages. */
  tool: z
    .object({
      name: z.string(),
      /** The call's key argument, such as a shell command or file path. */
      input: z.string().default(''),
      output: z.string().default(''),
      /** Previews of images the call's result carried, such as a screenshot read from disk. */
      images: z.array(z.string()).max(4).readonly().optional(),
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
/** The buttons that hand a job to an agent, each with instructions the user can edit. */
export const ACTION_IDS = [
  'createPr',
  'push',
  'resolveConflicts',
  'fixChecks',
] as const;
export const actionId = z.enum(ACTION_IDS);

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
  /** Asks the agent to write replies in Simplified Technical English (ASD-STE100). */
  simplifiedEnglish: z.boolean(),
  /** Archives conversations once the pull request for their branch is merged, through the `gh` CLI. */
  archiveOnMerge: z.boolean(),
  /** Keeps the system awake while a turn runs. */
  caffeinate: z.boolean(),
  /** The instructions each action sends its agent; unset ones use the defaults. */
  actionPrompts: z.partialRecord(actionId, z.string().max(20_000)),
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
  /** The project the pane works in. Only panes saved before projects existed lack one. */
  projectId: id.optional(),
  type: paneType,
  title: z.string(),
  threadId: z.string().optional(),
  messages: z.array(conversationMessageSchema).default([]),
  usage: usageSchema.optional(),
  model: z.string().default(''),
  reasoningEffort: reasoningEffort.default('medium'),
  /** Claude's faster, pricier output; other agents ignore it. */
  fastMode: z.boolean().default(false),
  /** Panes from before permissions were configurable ran unattended. */
  approvals: approvalMode.default('auto'),
  /** The branch the conversation last worked on, and since when, to spot its pull request merging. */
  workBranch: z.object({ name: z.string(), since: z.number() }).optional(),
  /** A terminal pane that shows a run script's output rather than a shell. */
  scriptId: id.optional(),
  /** The page a browser pane last showed. */
  url: z.string().optional(),
  archived: z.boolean().default(false),
  /** When the pane was closed, to list the latest first; panes closed before this was kept lack it. */
  archivedAt: z.number().optional(),
  /** The branch checked out when the pane was closed, which lists it among that branch's. */
  closedBranch: z.string().optional(),
});

/** How a connection signs in: the SSH agent and config as they are, or a key file. */
export const sshAuth = z.enum(['default', 'identity']);

/** A machine reached over SSH, whose folders can hold projects. */
export const sshConnectionSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  /** `host`, `user@host`, or an alias from `~/.ssh/config`. */
  host: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\s-][^\s]*$/, 'Enter a hostname such as user@host.com'),
  port: z.number().int().min(1).max(65_535).optional(),
  auth: sshAuth.default('default'),
  /** The private key to sign in with, when `auth` is `identity`. */
  identityFile: z.string().trim().max(4096).optional(),
});

/** A command that starts the project, such as its dev server, run from the header's Run button. */
export const runScriptSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1).max(10_000),
});

export const projectSchema = z.object({
  id,
  name: z.string(),
  /** The folder, on the connection's machine when there is one. */
  path: z.string(),
  /** The SSH connection the project lives on; unset for folders on this computer. */
  connectionId: id.optional(),
  createdAt: z.number(),
  lastOpenedAt: z.number(),
  /** The project's run scripts; unset until they are first detected from its files. */
  scripts: z.array(runScriptSchema).optional(),
  /** The script the Run button starts: the one last run. */
  runScriptId: id.optional(),
});

export const stateSchema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema),
  panes: z.array(paneSchema),
  connections: z.array(sshConnectionSchema).default([]),
  layout: z.object({ paneIds: z.array(id) }),
  /** The project on screen. */
  lastProjectId: id.optional(),
  settings: z.object({
    lastProvider: assistantProvider.optional(),
    lastModels: z
      .object({ claude: z.string(), codex: z.string() })
      .partial()
      .optional(),
    /** The thinking effort of the last message sent, which new panes start with. */
    lastReasoningEffort: reasoningEffort.optional(),
  }),
  preferences: preferencesSchema.partial().default({}),
});

const filePath = z.string().max(4096);
/** The largest pasted image, in bytes, that can be attached. */
export const MAX_IMAGE_BYTES = 30_000_000;

/** The longest text, in characters, that can be attached. */
export const MAX_TEXT_ATTACHMENT_LENGTH = 1_000_000;

/** Most skills one message can carry. */
export const MAX_SKILLS = 8;

export const assistantSendInput = z
  .object({
    paneId: id,
    /** May be empty when a skill is attached, as a skill can run on its own. */
    text: z.string().trim().max(100_000),
    attachmentIds: z.array(id).max(8).default([]),
    /** Names of skills to run with the message, from `assistant.skills`. */
    skills: z.array(z.string().min(1).max(200)).max(MAX_SKILLS).default([]),
    model: z.string().max(100),
    reasoningEffort,
    fastMode: z.boolean().default(false),
    approvals: approvalMode,
    /** How to deliver the message if a turn is already running; without it the send is refused. */
    followUp: followUpMode.optional(),
  })
  .refine((input) => input.text || input.skills.length, {
    message: 'A message needs text or a skill',
    path: ['text'],
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

/**
 * Terminals belong to a pane. Terminal panes run a shell; agent panes can run a
 * shell or their provider's CLI.
 */
export const terminalCreateInput = z.object({
  projectId: id,
  paneId: id,
  type: z.enum(['claude', 'codex', 'shell']),
});

/** A branch name as typed; git decides whether it is valid. */
export const branchName = z.string().trim().min(1).max(200);

export const projectCreateInput = z.object({
  name: z.string().trim().min(1).max(100),
  path: z.string().trim().min(1).max(4096),
  connectionId: id.optional(),
});

/** A repository to clone into a new folder inside `parent` on this computer. */
export const projectCloneInput = z.object({
  url: z.string().trim().min(1).max(2048),
  parent: z.string().trim().min(1).max(4096),
});

/** A run script as entered in its dialog; a new one has no id yet. */
export const runScriptInput = runScriptSchema.extend({ id: id.optional() });

/** A connection as entered in its dialog; a new one has no id yet. */
export const sshConnectionInput = sshConnectionSchema.extend({
  id: id.optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateInput>;
export type ProjectCloneInput = z.infer<typeof projectCloneInput>;
export type SshConnection = z.infer<typeof sshConnectionSchema>;
export type SshConnectionInput = z.infer<typeof sshConnectionInput>;
export type SshAuth = z.infer<typeof sshAuth>;
export type RunScript = z.infer<typeof runScriptSchema>;
export type RunScriptInput = z.infer<typeof runScriptInput>;
/** A run script found in the project's files, such as its `dev` script. */
export type ScriptSuggestion = Omit<RunScript, 'id'>;
export type ScriptList = {
  scripts: RunScript[];
  /** The script the Run button starts. */
  selectedId?: string;
};
/** A run script's process, shown in its own terminal pane. */
export type ScriptRun = {
  projectId: string;
  scriptId: string;
  paneId: string;
  terminalId: string;
  running: boolean;
  exitCode?: number;
};
export type Pane = z.infer<typeof paneSchema>;
export type PaneType = z.infer<typeof paneType>;
export type ToolPaneType = z.infer<typeof toolPaneType>;
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
export type ActionId = z.infer<typeof actionId>;
/** A message waiting for the running turn to end. */
export type QueuedPrompt = { id: string; text: string; attachments: number };
/** The signed-in account of a provider's CLI. */
export type ProviderAccount = {
  provider: AssistantProvider;
  signedIn: boolean;
  email?: string;
  plan?: string;
};
/**
 * A sign-in on a machine reached over SSH can't finish itself the way a local one does: there
 * is no browser there to catch the redirect. Claude's CLI waits instead for the code the
 * browser shows, given back through `submitSignInCode`. Codex's instead shows a code of its
 * own to enter at `verificationUrl`, and finishes on its own once that's done; `awaitSignIn`
 * resolves when it does.
 */
export type NeedsSignInCode = { needsCode: true };
export type NeedsDeviceAuth = { userCode: string; verificationUrl: string };
export type SignInWaiting = NeedsSignInCode | NeedsDeviceAuth;
/** The CLI of a provider that a machine runs, against the version the app expects. */
export type CliVersion = {
  provider: AssistantProvider;
  /** `local`, or the id of the SSH connection. */
  machineId: string;
  machineName: string;
  /** Unset when the CLI isn't installed there or didn't answer. */
  installed?: string;
  /** Unset when the expected version couldn't be read. */
  required?: string;
  /** Older than `required`, so it may not do what the app asks or run the newest models. */
  outdated: boolean;
};
export type GithubStatus =
  { installed: false } | { installed: true; login?: string };
/** A repository the signed-in GitHub account can reach, for cloning. */
export type GithubRepository = {
  /** `owner/name`. */
  fullName: string;
  description?: string;
  private: boolean;
  /** When it was last pushed to, in milliseconds since the epoch. */
  pushedAt: number;
  cloneUrl: string;
  /** The owner's avatar. */
  avatarUrl?: string;
};
/** A GitHub device-flow sign-in waiting for the user to enter the code. */
export type GithubSignIn = { userCode: string; verificationUrl: string };
/** How a GitHub sign-in ended: the account gh now uses, and why it failed if it did. */
export type GithubSignInEnd = { status: GithubStatus; error?: string };
export type PullRequest = {
  number: number;
  url: string;
  title: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  /** The branch it merges into, such as `main`. */
  base: string;
  /** Whether the branch merges cleanly into its base; unknown while GitHub works it out. */
  mergeable: 'yes' | 'no' | 'unknown';
  /** The combined result of the pull request's checks. */
  checks: 'none' | 'pending' | 'passing' | 'failing';
};
/**
 * Work pushed to the project's repository, as listed in the activity panel: a pull
 * request, or a commit pushed straight to the default branch without one.
 */
export type Activity = {
  /** Unique across both kinds: `pr-<number>` or `commit-<sha>`. */
  id: string;
  kind: 'pull' | 'push';
  title: string;
  url: string;
  /** Set for pull requests. */
  state?: PullRequest['state'];
  /** The GitHub login of whoever opened or pushed it, else their git name. */
  author: string;
  avatarUrl?: string;
  /** Lines added and removed; unset when GitHub doesn't report them. */
  additions?: number;
  deletions?: number;
  /** When it last changed, or for a push when it was committed, in milliseconds since the epoch. */
  at: number;
};
/** What a new pull request from the checked-out branch would contain. */
export type PullRequestDraft = {
  branch: string;
  base: string;
  /** A suggested title and description, from the branch's commits. */
  title: string;
  body: string;
  /** Subjects of the commits the branch has beyond its base, newest first. */
  commits: string[];
  /** Files with changes that aren't committed yet. */
  uncommitted: number;
  /** Commits not pushed yet. */
  unpushed: number;
  /** Why no pull request can be opened from here, if so. */
  blocked?: string;
};
export const pullRequestInput = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().max(65_536),
  /** Commit uncommitted changes first, with the title as the message. */
  commit: z.boolean(),
});
export type PullRequestInput = z.infer<typeof pullRequestInput>;
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
  /** Whether the model can run in fast mode. */
  supportsFast?: boolean;
};
/** A skill (or prompt command) the provider's CLI can run, attached in the composer with `/`. */
export type Skill = {
  name: string;
  description: string;
  /** What to type after the skill, e.g. `<file>`. */
  argumentHint?: string;
  /** The skill's SKILL.md, for providers that load a skill by path. */
  path?: string;
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
export type Change = {
  path: string;
  index: string;
  worktree: string;
  /** Lines added and removed against HEAD; zero for binary files. */
  additions: number;
  deletions: number;
};
export type GitStatus = { isGit: boolean; branch: string; changes: Change[] };
/** What a project folder has checked out. */
export type GitHead = {
  isGit: boolean;
  /** Unset when HEAD is detached or the folder isn't a repository. */
  branch?: string;
};
/** A local branch, as listed for switching to. */
export type Branch = {
  name: string;
  /** The subject of its newest commit. */
  subject: string;
  /** When its newest commit was made, in milliseconds since the epoch. */
  committedAt: number;
};
export type Entry = { name: string; directory: boolean };
/** A folder on a connection's machine and the folders inside it, for picking a project. */
export type RemoteFolder = { path: string; parent?: string; folders: string[] };
/** How reaching a connection went. */
export type ConnectionCheck =
  { ok: true; home: string } | { ok: false; error: string };
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
  /**
   * The terminal ended because the terminal host stopped. Main sends this, not the host, so
   * it stands outside the terminal's own sequence.
   */
  hostStopped?: true;
};
/**
 * Something changed in a project's folder: its `files`, including what Git has staged; the
 * `head`, which branch Git has checked out; or `refs`, such as after a commit or push.
 */
export type FileChangeEvent = {
  projectId: string;
  kind: 'files' | 'head' | 'refs';
};
/** Panes the app archived on its own, such as when their pull request merged. */
export type PanesClosedEvent = {
  paneIds: string[];
  reason: 'merged';
};

/** What the dictation helper reports while it listens; `session` is the id `start` returned. */
export type DictationEvent = { session: string } & (
  | { type: 'ready' }
  /** Everything heard so far; earlier words may be revised as recognition firms up. */
  | { type: 'result'; text: string }
  | { type: 'level'; level: number }
  | { type: 'error'; error: string }
  | { type: 'end' }
);

/** IPC argument schemas, keyed by `group.method`. Every channel is validated in main. */
export const requests = {
  'state.get': z.tuple([]),
  'preferences.get': z.tuple([]),
  'preferences.update': z.tuple([preferencesSchema.partial()]),
  'providers.account': z.tuple([assistantProvider]),
  'providers.connect': z.tuple([
    assistantProvider,
    z.union([z.literal('local'), id]).optional(),
  ]),
  'providers.submitSignInCode': z.tuple([assistantProvider, z.string()]),
  'providers.awaitSignIn': z.tuple([assistantProvider]),
  'providers.cancelConnect': z.tuple([assistantProvider]),
  'providers.outputStyles': z.tuple([]),
  'providers.cliVersions': z.tuple([]),
  'providers.updateCli': z.tuple([
    assistantProvider,
    z.union([z.literal('local'), id]),
  ]),
  'github.status': z.tuple([]),
  'github.connect': z.tuple([]),
  'github.cancelConnect': z.tuple([]),
  'github.repositories': z.tuple([]),
  'github.pullRequest': z.tuple([id]),
  'github.pullRequestDraft': z.tuple([id]),
  'github.createPullRequest': z.tuple([id, pullRequestInput]),
  'github.runAction': z.tuple([id, actionId]),
  'github.mergePullRequest': z.tuple([id]),
  'github.openPullRequest': z.tuple([id]),
  'github.activity': z.tuple([id]),
  'github.openActivity': z.tuple([z.string().url().max(2048)]),
  'projects.chooseFolder': z.tuple([]),
  'projects.create': z.tuple([projectCreateInput]),
  'projects.clone': z.tuple([projectCloneInput]),
  'projects.cloneFolder': z.tuple([]),
  'projects.open': z.tuple([id]),
  'projects.remove': z.tuple([id]),
  'projects.favicon': z.tuple([id]),
  'connections.list': z.tuple([]),
  'connections.save': z.tuple([sshConnectionInput]),
  'connections.remove': z.tuple([id]),
  'connections.check': z.tuple([sshConnectionInput]),
  'connections.chooseIdentity': z.tuple([]),
  'connections.browse': z.tuple([id, filePath.optional()]),
  'panes.add': z.tuple([paneType.optional(), z.boolean().optional()]),
  'panes.fork': z.tuple([id, z.string().min(1).max(200), assistantProvider]),
  'panes.archive': z.tuple([id]),
  'panes.reopen': z.tuple([id]),
  'panes.reorder': z.tuple([z.array(id).max(100)]),
  'panes.rename': z.tuple([id, z.string().trim().min(1).max(200)]),
  'panes.navigate': z.tuple([id, browserUrl]),
  'assistant.send': z.tuple([assistantSendInput]),
  'assistant.pickAttachment': z.tuple([id]),
  'assistant.attachFile': z.tuple([id, filePath]),
  'assistant.attachImage': z.tuple([
    id,
    z.string().max(255),
    z
      .instanceof(Uint8Array)
      .refine(
        (data) => data.byteLength > 0 && data.byteLength <= MAX_IMAGE_BYTES,
      ),
  ]),
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
  'assistant.skills': z.tuple([id]),
  'limits.get': z.tuple([assistantProvider]),
  'tokens.get': z.tuple([tokenRange]),
  'navigation.help': z.tuple([]),
  'app.isFullscreen': z.tuple([]),
  'app.copyText': z.tuple([z.string().max(1_048_576)]),
  'dictation.available': z.tuple([]),
  'dictation.start': z.tuple([z.string().max(64)]),
  'dictation.stop': z.tuple([id]),
  'scripts.list': z.tuple([id]),
  'scripts.detect': z.tuple([id]),
  'scripts.save': z.tuple([id, runScriptInput]),
  'scripts.remove': z.tuple([id, id]),
  'scripts.run': z.tuple([id, id]),
  'scripts.stop': z.tuple([id, id]),
  'scripts.runs': z.tuple([id]),
  'terminal.create': z.tuple([terminalCreateInput]),
  'terminal.snapshot': z.tuple([id]),
  'git.status': z.tuple([id]),
  'git.head': z.tuple([id]),
  'git.localBranches': z.tuple([id]),
  'git.branches': z.tuple([id]),
  'git.diff': z.tuple([id, filePath]),
  'git.discard': z.tuple([id, filePath.optional()]),
  'git.changesAmong': z.tuple([id, z.array(filePath).min(1).max(32)]),
  'git.checkout': z.tuple([id, branchName]),
  'git.createBranch': z.tuple([id, branchName, branchName]),
  'git.pull': z.tuple([id]),
  'filesystem.list': z.tuple([id, filePath]),
  'filesystem.readFile': z.tuple([id, filePath]),
  'filesystem.search': z.tuple([id, z.string().max(256)]),
  'filesystem.watch': z.tuple([id]),
  'filesystem.unwatch': z.tuple([id]),
};

/**
 * Calls the window sends straight to the terminal host over its own channel, not to main.
 * The host checks each as main checks its requests.
 */
export const terminalHostRequests = {
  'terminal.write': z.tuple([id, z.string().max(1_048_576)]),
  'terminal.resize': z.tuple([
    id,
    z.number().int().min(2).max(500),
    z.number().int().min(1).max(300),
  ]),
  'terminal.ack': z.tuple([
    id,
    z
      .number()
      .int()
      .min(0)
      .max(1 << 30),
  ]),
};

/** Push channels from main to the renderer. */
export const events = {
  terminalData: 'terminal:data',
  /** Hands the window its own channel to the terminal host; asked for by the preload. */
  terminalPort: 'terminal:port',
  assistantEvent: 'assistant:event',
  fileChange: 'filesystem:change',
  fullscreen: 'window:fullscreen',
  focusPane: 'window:focus-pane',
  notificationsBlocked: 'window:notifications-blocked',
  panesClosed: 'panes:closed',
  githubSignInEnd: 'github:sign-in-end',
  scriptRun: 'scripts:run',
  dictationEvent: 'dictation:event',
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
    /**
     * Signs in through the browser, replacing the current account; resolves once done. Signs
     * in on `machineId` (`local`, or an SSH connection's id) rather than this computer; a
     * machine reached over SSH asks for the browser's code next, through `submitSignInCode`.
     */
    connect(
      provider: AssistantProvider,
      machineId?: string,
    ): Promise<ProviderAccount | SignInWaiting>;
    /** Finishes a sign-in that asked for the code the browser showed. */
    submitSignInCode(
      provider: AssistantProvider,
      code: string,
    ): Promise<ProviderAccount>;
    /** Waits out a sign-in that showed its own code, until the user enters it and it's done. */
    awaitSignIn(provider: AssistantProvider): Promise<ProviderAccount>;
    cancelConnect(provider: AssistantProvider): Promise<void>;
    /** Output styles Claude offers, built-in and the user's own. */
    outputStyles(): Promise<string[]>;
    /** The enabled providers' CLI versions on this computer and on the open project's machine. */
    cliVersions(): Promise<CliVersion[]>;
    /** Updates a provider's CLI on a machine (`local` or a connection id); returns its new version. */
    updateCli(
      provider: AssistantProvider,
      machineId: string,
    ): Promise<CliVersion>;
  };
  github: {
    status(): Promise<GithubStatus>;
    /**
     * Starts a device-flow sign-in; how it ends arrives through `onSignInEnd`. Signing in
     * as another account adds it to gh and makes it the active one.
     */
    connect(): Promise<GithubSignIn>;
    cancelConnect(): Promise<void>;
    /** Repositories the signed-in account owns or works on, recently pushed first. */
    repositories(): Promise<GithubRepository[]>;
    /** The newest pull request from the project's checked-out branch, or null if it has none. */
    pullRequest(projectId: string): Promise<PullRequest | null>;
    pullRequestDraft(projectId: string): Promise<PullRequestDraft>;
    /** Pushes the branch and opens a pull request against the remote's default branch. */
    createPullRequest(
      projectId: string,
      input: PullRequestInput,
    ): Promise<PullRequest>;
    /**
     * Opens a new pane with the last-used agent and sends it the instructions of `action`
     * (editable in Settings); resolves with the pane's id once the message is on its way.
     */
    runAction(projectId: string, action: ActionId): Promise<string>;
    /** Squash-merges the open pull request of the checked-out branch. */
    mergePullRequest(projectId: string): Promise<void>;
    openPullRequest(projectId: string): Promise<void>;
    /**
     * The project repository's pull requests and the commits pushed straight to its
     * default branch, newest first.
     */
    activity(projectId: string): Promise<Activity[]>;
    /** Opens a pull request from the activity list in the browser; only github.com links. */
    openActivity(url: string): Promise<void>;
    onSignInEnd(listener: (end: GithubSignInEnd) => void): Unsubscribe;
  };
  projects: {
    /** Asks for a folder on this computer; null if the user cancels. */
    chooseFolder(): Promise<string | null>;
    /** Adds a folder, here or on a connection's machine, and opens it. */
    create(input: ProjectCreateInput): Promise<Project>;
    /** Clones a repository on this computer, then adds and opens it. */
    clone(input: ProjectCloneInput): Promise<Project>;
    /** Where clones go unless another folder is chosen. */
    cloneFolder(): Promise<string>;
    /** Puts the project on screen. */
    open(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    favicon(id: string): Promise<string | null>;
  };
  connections: {
    list(): Promise<SshConnection[]>;
    /** Adds or updates a connection. */
    save(input: SshConnectionInput): Promise<SshConnection>;
    /** Removes a connection no project uses. */
    remove(id: string): Promise<void>;
    /** Tries signing in with the connection as entered, saved or not. */
    check(input: SshConnectionInput): Promise<ConnectionCheck>;
    /** Asks for a private key file; null if the user cancels. */
    chooseIdentity(): Promise<string | null>;
    /** The folders in `path` on the connection's machine, its home folder by default. */
    browse(id: string, path?: string): Promise<RemoteFolder>;
  };
  panes: {
    /**
     * Adds a pane at the front of the project on screen; an agent pane by default.
     * With `other`, the agent is the enabled provider that new panes don't start with.
     */
    add(type?: PaneType, other?: boolean): Promise<Pane>;
    /**
     * Summarizes the conversation up to `messageId` and opens a new pane with `provider`,
     * the summary attached so the user can continue the work with a different agent.
     */
    fork(
      paneId: string,
      messageId: string,
      provider: AssistantProvider,
    ): Promise<{ pane: Pane; attachment: Attachment }>;
    onClosed(listener: (event: PanesClosedEvent) => void): Unsubscribe;
    archive(id: string): Promise<void>;
    /** Opens a closed agent pane again, with its conversation, at the front of the strip. */
    reopen(id: string): Promise<void>;
    /** Reorders the given panes among the layout slots they already occupy. */
    reorder(ids: string[]): Promise<void>;
    /** Gives the pane a title of the user's choosing. */
    rename(id: string, title: string): Promise<void>;
    /** Remembers the page a browser pane is showing, so it reopens there. */
    navigate(id: string, url: string): Promise<void>;
  };
  assistant: {
    send(input: AssistantSendInput): Promise<void>;
    pickAttachment(paneId: string): Promise<Attachment | null>;
    /** Attaches an image dropped onto the pane, by its path on disk. */
    attachFile(paneId: string, path: string): Promise<Attachment>;
    /** Attaches image data that has no file on disk, e.g. a screenshot on the clipboard. */
    attachImage(
      paneId: string,
      name: string,
      data: Uint8Array,
    ): Promise<Attachment>;
    attachText(paneId: string, text: string): Promise<Attachment>;
    /** Sends a queued message now: it steers the running turn, or starts one. */
    sendQueued(paneId: string, queuedId: string): Promise<void>;
    unqueue(paneId: string, queuedId: string): Promise<void>;
    cancel(paneId: string): Promise<void>;
    respond(input: AssistantRespondInput): Promise<void>;
    snapshot(paneId: string): Promise<AssistantSnapshot>;
    models(provider: AssistantProvider): Promise<ModelOption[]>;
    /** Skills the pane's provider can run in its project, for the composer's `/` menu. */
    skills(paneId: string): Promise<Skill[]>;
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
    /** Puts text on the system clipboard; the sandboxed renderer can't write to it directly. */
    copyText(text: string): Promise<void>;
    /** The path on disk of a file from a drop or file input. */
    pathForFile(file: File): string;
    onFullscreenChange(listener: (fullscreen: boolean) => void): Unsubscribe;
    /** A notification for a pane was clicked. */
    onFocusPane(listener: (paneId: string) => void): Unsubscribe;
    /** The OS refused a notification; carries the app name to allow in its settings. */
    onNotificationsBlocked(listener: (appName: string) => void): Unsubscribe;
  };
  dictation: {
    /** Whether this computer can dictate (macOS, with the helper built). */
    available(): Promise<boolean>;
    /**
     * Starts listening in the given language (BCP 47; empty for the system's) and resolves
     * with the session id its events carry. Starting again ends the previous session.
     */
    start(language: string): Promise<string>;
    /** Stops listening; the last words and an `end` event follow shortly. */
    stop(session: string): Promise<void>;
    onEvent(listener: (event: DictationEvent) => void): Unsubscribe;
  };
  scripts: {
    /** The project's run scripts; the first time, those detected from its files. */
    list(projectId: string): Promise<ScriptList>;
    /** Scripts found in the project's files, best first, such as each app of a monorepo. */
    detect(projectId: string): Promise<ScriptSuggestion[]>;
    /** Adds a script, or updates the one with the input's id. */
    save(projectId: string, input: RunScriptInput): Promise<RunScript>;
    /** Deletes a script, stopping it and closing its pane. */
    remove(projectId: string, scriptId: string): Promise<void>;
    /**
     * Runs a script in its terminal pane, opened if needed, restarting it if it is running;
     * resolves with the pane's id.
     */
    run(projectId: string, scriptId: string): Promise<string>;
    stop(projectId: string, scriptId: string): Promise<void>;
    /** The project's scripts that have run since the app started, running or not. */
    runs(projectId: string): Promise<ScriptRun[]>;
    onRun(listener: (run: ScriptRun) => void): Unsubscribe;
  };
  terminal: {
    create(input: TerminalCreateInput): Promise<string>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    snapshot(id: string): Promise<TerminalSnapshot>;
    /**
     * Says how much of the output the window has shown, so a program writing faster than
     * it can be shown is paused rather than piling up in the window.
     */
    ack(id: string, chars: number): Promise<void>;
    onData(listener: (event: TerminalEvent) => void): Unsubscribe;
  };
  git: {
    status(projectId: string): Promise<GitStatus>;
    head(projectId: string): Promise<GitHead>;
    /** Local branches to switch to, most recently committed first. */
    localBranches(projectId: string): Promise<Branch[]>;
    /** Local and remote-tracking branches, to start a new branch from. */
    branches(projectId: string): Promise<string[]>;
    diff(projectId: string, path: string): Promise<string>;
    /** Throws away the uncommitted changes to one file, or to all of them without a path. */
    discard(projectId: string, path?: string): Promise<void>;
    /** The current changes among the given paths, such as the files a turn edited. */
    changesAmong(projectId: string, paths: string[]): Promise<Change[]>;
    /**
     * Switches the project folder to another branch. Uncommitted changes come along when
     * they can; refused while an agent in the project is working.
     */
    checkout(projectId: string, branch: string): Promise<void>;
    /** Creates a branch from `base` and switches to it, as `checkout` does. */
    createBranch(projectId: string, name: string, base: string): Promise<void>;
    /** Fast-forwards the checked-out branch to its upstream. */
    pull(projectId: string): Promise<void>;
  };
  filesystem: {
    list(projectId: string, path: string): Promise<Entry[]>;
    readFile(projectId: string, path: string): Promise<string>;
    /** Project file paths matching `query`, best match first. */
    search(projectId: string, query: string): Promise<string[]>;
    /** Starts reporting changes; false when they can't be, such as in a remote folder. */
    watch(projectId: string): Promise<boolean>;
    unwatch(projectId: string): Promise<void>;
    onChange(listener: (event: FileChangeEvent) => void): Unsubscribe;
  };
};

/** Methods the preload sends to the terminal host rather than to main. */
type TerminalHostMethods = {
  [
    Channel in keyof typeof terminalHostRequests
  ]: Channel extends `terminal.${infer Method}` ? Method : never;
}[keyof typeof terminalHostRequests];

/**
 * The request/response half of the API that main implements: no push subscriptions,
 * preload-only helpers, or calls that go to the terminal host.
 */
export type Backend = {
  [Group in keyof API]: {
    [
      Method in keyof API[Group] as Method extends
        | `on${string}`
        | 'pathForFile'
        | (Group extends 'terminal' ? TerminalHostMethods : never)
        ? never
        : Method
    ]: API[Group][Method];
  };
};

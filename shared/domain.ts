import type {
  ActionId,
  AssistantProvider,
  ConversationMessage,
  Pane,
  Preferences,
  Project,
  SshConnection,
  State,
  ToolPaneType,
  Workspace,
} from './contracts';
import { landmarkLabel } from './landmarks';

export const DEFAULT_TITLE = 'New Conversation';
const TITLE_MAX_LENGTH = 42;

export const PROVIDER_LABELS: Record<AssistantProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** What each provider's command-line tool is called. */
export const CLI_NAMES: Record<AssistantProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

const PROVIDERS = Object.keys(PROVIDER_LABELS) as AssistantProvider[];

/** The provider new panes start with: the chosen default, else the last used, else the first enabled. */
export function startingProvider(
  { defaultModel, providers }: Pick<Preferences, 'defaultModel' | 'providers'>,
  lastProvider?: AssistantProvider,
): AssistantProvider {
  if (defaultModel && providers[defaultModel.provider])
    return defaultModel.provider;
  if (lastProvider && providers[lastProvider]) return lastProvider;
  return PROVIDERS.find((option) => providers[option]) ?? 'claude';
}

/** The enabled provider other than `provider`; `provider` itself when it is the only one. */
export function otherProvider(
  provider: AssistantProvider,
  providers: Preferences['providers'],
) {
  return (
    PROVIDERS.find((option) => option !== provider && providers[option]) ??
    provider
  );
}

/** What tool panes are called; agent panes are named after their conversation. */
export const TOOL_PANE_TITLES: Record<ToolPaneType, string> = {
  files: 'Files',
  terminal: 'Terminal',
  diff: 'Changes',
  browser: 'Browser',
};

/**
 * Tool panes that show the branch itself. A second one would only repeat the first, so
 * a project has at most one of each, at the end of the strip, and the header toggles it.
 */
export const VIEW_PANE_TYPES = ['files', 'diff', 'browser'] as const;
export type ViewPaneType = (typeof VIEW_PANE_TYPES)[number];

export function isViewPaneType(type: string): type is ViewPaneType {
  return (VIEW_PANE_TYPES as readonly string[]).includes(type);
}

/** Whether the pane is a conversation with an agent, rather than a tool pane. */
export function isAssistantPane<Item extends Pick<Pane, 'type'>>(
  pane: Item,
): pane is Item & { type: AssistantProvider } {
  return pane.type in PROVIDER_LABELS;
}

/**
 * Whether a closed pane can be reopened. A run script's pane only showed one run's output,
 * which went with it; running the script again opens a new one.
 */
export function isReopenable(pane: Pick<Pane, 'archived' | 'scriptId'>) {
  return pane.archived && !pane.scriptId;
}

/** Older panes were titled after their provider before the first message. */
export function isDefaultTitle(title: string) {
  return (
    title === DEFAULT_TITLE || Object.values(PROVIDER_LABELS).includes(title)
  );
}

export function titleFrom(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > TITLE_MAX_LENGTH
    ? `${compact.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : compact;
}

/** Tool calls that write a file, keyed by the name both providers use for them. */
const FILE_EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/**
 * The files a turn's tool calls edited, each path once, in the order first touched. A
 * Codex `fileChange` can cover several files at once, its paths joined with `, `.
 */
export function editedPaths(
  messages: readonly Pick<ConversationMessage, 'kind' | 'tool'>[],
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.kind !== 'tool' || !message.tool) continue;
    if (!FILE_EDIT_TOOLS.has(message.tool.name)) continue;
    for (const raw of message.tool.input.split(', ')) {
      const path = raw.trim();
      if (path && !seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
  }
  return paths;
}

/**
 * Where an attachment sits in a prompt: the composer writes this marker into the text at
 * the caret, so the attachment is sent and shown in place.
 */
export function attachmentMarker(id: string) {
  return `[[attachment:${id}]]`;
}

const ATTACHMENT_MARKER = /\[\[attachment:([\w-]+)\]\]/g;

/**
 * Where a skill sits in a prompt: the composer writes this marker where the skill was
 * picked, so the message is shown as it was typed. Providers get `/name` in its place.
 */
export function skillMarker(name: string) {
  return `[[skill:${name}]]`;
}

const SKILL_MARKER = /\[\[skill:([^\]\s]+)\]\]/g;

/** The skills a prompt names with markers, in order, each once. */
export function markedSkills(text: string) {
  return [
    ...new Set([...text.matchAll(SKILL_MARKER)].map((match) => match[1])),
  ];
}

/** The text with each skill marker written as the `/name` it was typed as. */
export function withSkillNames(text: string) {
  return text.replace(SKILL_MARKER, (_, name: string) => `/${name}`);
}

/** A prompt cut at its markers, for showing it: text, attachment ids and skill names, in order. */
export type PromptPart =
  { text: string } | { attachmentId: string } | { skill: string };

export function promptParts(text: string): PromptPart[] {
  return splitPrompt(text).flatMap((part): PromptPart[] => {
    if (!('text' in part)) return [part];
    const parts: PromptPart[] = [];
    let last = 0;
    for (const match of part.text.matchAll(SKILL_MARKER)) {
      if (match.index > last)
        parts.push({ text: part.text.slice(last, match.index) });
      parts.push({ skill: match[1] });
      last = match.index + match[0].length;
    }
    if (last < part.text.length) parts.push({ text: part.text.slice(last) });
    return parts;
  });
}

/** A prompt cut at its attachment markers: plain text, and attachment ids, in order. */
export function splitPrompt(
  text: string,
): ({ text: string } | { attachmentId: string })[] {
  const parts: ({ text: string } | { attachmentId: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(ATTACHMENT_MARKER)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ attachmentId: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * The text with its attachment markers taken out and its skills as `/name`, for titles
 * and queue previews.
 */
export function withoutMarkers(text: string) {
  return withSkillNames(text)
    .replace(ATTACHMENT_MARKER, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * A message as the user sees it. Skills sit where they were typed; any the text doesn't
 * place (from before skills were placed) lead as `/name`. Skills are named once.
 */
export function promptText(
  text: string,
  skills: (string | { name: string })[],
) {
  const placed = new Set(markedSkills(text));
  const names = new Set(
    skills
      .map((skill) => (typeof skill === 'string' ? skill : skill.name))
      .filter((name) => !placed.has(name)),
  );
  return [...[...names].map((name) => `/${name}`), text]
    .filter(Boolean)
    .join(' ');
}

export function emptyState(): State {
  return {
    version: 1,
    projects: [],
    workspaces: [],
    panes: [],
    connections: [],
    layout: { paneIds: [] },
    settings: {},
    preferences: {},
  };
}

/** The OKLCH hue of the original orange accent, #ea580c. */
export const DEFAULT_ACCENT_HUE = 41;

/** Pasted text longer than this becomes an attachment when `convertLongText` is on. */
export const LONG_TEXT_THRESHOLD = 5_000;

/** Below this battery charge, in percent, `caffeinate` lets the system sleep again. */
export const CAFFEINATE_BATTERY_FLOOR = 10;

export const ACTION_LABELS: Record<ActionId, string> = {
  createPr: 'Create PR',
  push: 'Push changes',
  resolveConflicts: 'Resolve conflicts',
  fixChecks: 'Fix checks',
};

/** What each action tells its agent to do. `{branch}` and `{base}` are filled in when sent. */
export const DEFAULT_ACTION_PROMPTS: Record<ActionId, string> = {
  createPr: [
    'Follow these steps to create a PR:',
    '',
    '- If you have any skills related to creating PRs, invoke them now. Instructions there should take precedence over these instructions.',
    '- Run `git status` to check for uncommitted changes. If there are any, review them with `git diff` and commit them. Follow any instructions the user gave you about writing commit messages.',
    '- If the branch has no upstream or has unpushed commits, push with `git push -u origin HEAD`. If the branch tracks a remote branch with a different name or on a different remote, push to that upstream instead.',
    '- Review the full PR diff with `git diff origin/{base}...HEAD`.',
    '- Use `gh pr create --base {base}` to create a PR onto the target branch. Keep the title under 80 characters. Keep the description under five sentences, unless the user instructed you otherwise. Describe not just changes made in this session but ALL changes in the branch diff.',
    '',
    'If any of these steps fail, ask the user for help.',
  ].join('\n'),
  push: [
    'Follow these steps to push the changes:',
    '',
    '- Run `git status` to check for uncommitted changes. If there are any, review them with `git diff` and commit them with a clear message. Follow any instructions the user gave you about writing commit messages.',
    '- Push with `git push`, or `git push -u origin HEAD` if the branch has no upstream.',
    '- If the push is rejected because the remote has new commits, run `git pull --rebase`, resolve any conflicts, and push again. Never force push.',
    '',
    'If any of these steps fail, ask the user for help.',
  ].join('\n'),
  resolveConflicts: [
    'The pull request has merge conflicts with the target branch. Follow these steps to resolve them:',
    '',
    '- Run `git status` and commit or stash any uncommitted changes first.',
    '- Run `git fetch origin`, then `git merge origin/{base}`.',
    '- For each conflicted file, read both sides and combine them so the intent of both changes is kept. Remove every conflict marker.',
    "- Run the project's build or tests if it has them, to check the result.",
    '- Commit the merge and push with `git push`. Never force push.',
    '',
    'If any of these steps fail, or a conflict is ambiguous, ask the user for help.',
  ].join('\n'),
  fixChecks: [
    'The pull request has failing checks. Follow these steps to fix them:',
    '',
    '- Run `gh pr checks` to see which checks failed.',
    '- Read the failure logs with `gh run view <run-id> --log-failed`.',
    '- Find the cause in the code and fix it. Reproduce the failure locally first when you can.',
    '- Commit the fix and push it with `git push`.',
    '',
    'If a failure looks unrelated to this branch, or you cannot fix it, tell the user rather than guessing.',
  ].join('\n'),
};

/**
 * Asks for roughly 80% of ASD-STE100 (Simplified Technical English). The rules that
 * keep text easy to read are firm; the model may bend any rule that would make a
 * reply wrong, unclear, or much longer.
 */
export const SIMPLIFIED_ENGLISH_INSTRUCTIONS = [
  'Write every reply in Simplified Technical English, as in ASD-STE100. Follow these rules.',
  '',
  'Sentences:',
  '- Use short sentences. Aim for 20 words or fewer. Never go above 25.',
  '- Put one idea in each sentence. Give one instruction in each step.',
  '- Use the active voice. Use the imperative for instructions: "Run the test", not "The test should be run".',
  '- Use simple tenses only: simple present, simple past, and simple future. Avoid the perfect and progressive forms.',
  '- Do not drop the words "the", "a", and "an".',
  '- Use "must" for a required action, "can" for a possible one, and "will" for a result. Do not use "should", "may", or "might".',
  '',
  'Words:',
  '- Use plain, common words. Say "use", not "utilize". Say "start", not "initiate". Say "check", not "verify".',
  '- Use one word for one meaning, and keep using the same word. Do not swap in synonyms.',
  '- Avoid idioms, slang, figures of speech, and phrasal verbs with more than one meaning.',
  '- Repeat the noun when a pronoun is not clear. Avoid long strings of nouns.',
  '',
  'Layout:',
  '- Show the steps of a procedure as a numbered list.',
  '- Put a warning or caution before the step it applies to.',
  '- Keep paragraphs to six sentences or fewer.',
  '- Say the main point first. Do not add praise, filler, or a summary of what you just said.',
  '',
  'Keep these exactly as they are: code, commands, file paths, identifiers, error messages, and names of tools and products. Technical words that the reader needs are allowed.',
  'These rules are firm, but accuracy comes first. Break a rule when it would make a reply wrong, unclear, or much longer.',
].join('\n');

/** The instructions an action sends: the user's edit, or the default when it is empty. */
export function actionPrompt(preferences: Preferences, action: ActionId) {
  return (
    preferences.actionPrompts[action]?.trim() || DEFAULT_ACTION_PROMPTS[action]
  );
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultModel: null,
  approvals: 'auto',
  followUp: 'queue',
  textModel: { provider: 'claude', model: 'haiku' },
  convertLongText: true,
  accentHue: DEFAULT_ACCENT_HUE,
  notifications: true,
  completionSound: false,
  providers: { claude: true, codex: true },
  claudeOutputStyle: 'default',
  codexPersonality: 'default',
  simplifiedEnglish: false,
  archiveOnMerge: false,
  caffeinate: true,
  actionPrompts: DEFAULT_ACTION_PROMPTS,
};

/** Fills in the fields the user hasn't set. */
export function resolvePreferences(stored: Partial<Preferences>): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    actionPrompts: {
      ...DEFAULT_PREFERENCES.actionPrompts,
      ...stored.actionPrompts,
    },
  };
}

/** What went wrong, without the wrapping Electron adds to errors thrown in main. */
export function errorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    '',
  );
}

/**
 * A CLI's output with its colors and cursor moves cut out, to read URLs and codes out of it.
 * A program run over SSH often keeps coloring its output even though nothing shows it, since
 * there is no terminal there to say otherwise.
 */
export function stripAnsi(text: string) {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/** The most panes, of any type, a workspace can have open at once. */
export const MAX_PANES = 18;

/**
 * The most terminal panes, run scripts' included, a workspace can have open at once: as many
 * as the WebGL pool has contexts, so each can draw with WebGL while busy. Agent panes' CLI
 * terminals share the pool too; any terminal past it draws with the DOM renderer.
 */
export const MAX_TERMINAL_PANES = 15;

/**
 * Reorders `ids` among the layout slots they already occupy, leaving every other
 * pane (archived, another project's) where it was. Throws if `ids` isn't a subset of the layout.
 */
export function reorderLayout(paneIds: string[], ids: string[]) {
  const moving = new Set(ids);
  if (moving.size !== ids.length || ids.some((id) => !paneIds.includes(id)))
    throw new Error('Invalid pane order');
  const queue = [...ids];
  return paneIds.map((id) => (moving.has(id) ? queue.shift()! : id));
}

/** Where a project lives: its connection's name, or this computer. */
export function projectLocation(
  project: Pick<Project, 'connectionId'>,
  connections: SshConnection[],
) {
  if (!project.connectionId) return 'This computer';
  return (
    connections.find(({ id }) => id === project.connectionId)?.name ??
    'Removed connection'
  );
}

/**
 * The URL to clone for what was typed: a URL or scp-style address as is, and GitHub's
 * `owner/name` shorthand as its HTTPS URL. Undefined when it is neither.
 */
export function cloneUrl(input: string) {
  const text = input.trim();
  if (/^(https?|ssh|git|file):\/\/\S+$/.test(text)) return text;
  if (/^[\w.-]+@[\w.-]+:\S+$/.test(text)) return text;
  if (/^[\w.-]+\/[\w.-]+$/.test(text))
    return `https://github.com/${text.replace(/\.git$/, '')}.git`;
  return undefined;
}

/** The folder a clone of `url` goes in: its last segment without `.git`. */
export function repositoryName(url: string) {
  return (
    url
      .trim()
      .replace(/[\\/]+$/, '')
      .replace(/\.git$/, '')
      .split(/[\\/:]/)
      .pop() ?? ''
  );
}

/** The last segment of a path, for naming a project after its folder. */
export function folderName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  );
}

/** What a workspace is called in lists: its title, else the landmark it is named after. */
export function workspaceLabel(workspace: Pick<Workspace, 'title' | 'name'>) {
  return workspace.title || landmarkLabel(workspace.name);
}

type Workspaces<Item> = { readonly workspaces: readonly Item[] };

/** The project's main workspace: its own folder. */
export function mainWorkspaceOf<
  Item extends Pick<Workspace, 'projectId' | 'main'>,
>(state: Workspaces<Item>, projectId: string) {
  return state.workspaces.find(
    (workspace) => workspace.projectId === projectId && workspace.main,
  );
}

/**
 * The workspace the project shows: the one last on screen. The project folder's main
 * workspace is never shown, so a project with no worktree shows none.
 */
export function currentWorkspaceOf<
  Item extends Pick<Workspace, 'id' | 'projectId' | 'main'>,
>(state: Workspaces<Item>, project: Pick<Project, 'id' | 'lastWorkspaceId'>) {
  return state.workspaces.find(
    ({ id, projectId, main }) =>
      id === project.lastWorkspaceId && projectId === project.id && !main,
  );
}

/** A folder or branch name made from free text: lowercase words joined by hyphens. */
export function slug(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

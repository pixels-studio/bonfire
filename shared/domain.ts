import type {
  ActionId,
  AssistantProvider,
  Pane,
  Preferences,
  Project,
  SshConnection,
  State,
  ToolPaneType,
} from './contracts';

export const DEFAULT_TITLE = 'New Conversation';
const TITLE_MAX_LENGTH = 42;

export const PROVIDER_LABELS: Record<AssistantProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** What tool panes are called; agent panes are named after their conversation. */
export const TOOL_PANE_TITLES: Record<ToolPaneType, string> = {
  files: 'Files',
  terminal: 'Terminal',
  diff: 'Changes',
};

/** Whether the pane is a conversation with an agent, rather than a tool pane. */
export function isAssistantPane(
  pane: Pane,
): pane is Pane & { type: AssistantProvider } {
  return pane.type in PROVIDER_LABELS;
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

/**
 * Where an attachment sits in a prompt: the composer writes this marker into the text at
 * the caret, so the attachment is sent and shown in place.
 */
export function attachmentMarker(id: string) {
  return `[[attachment:${id}]]`;
}

const ATTACHMENT_MARKER = /\[\[attachment:([\w-]+)\]\]/g;

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

/** The text with its attachment markers taken out, for titles and queue previews. */
export function withoutMarkers(text: string) {
  return text.replace(ATTACHMENT_MARKER, ' ').replace(/ {2,}/g, ' ').trim();
}

/** A message as the user sees it: its skills as `/name`, then the text. Skills are named once. */
export function promptText(
  text: string,
  skills: (string | { name: string })[],
) {
  const names = new Set(
    skills.map((skill) => (typeof skill === 'string' ? skill : skill.name)),
  );
  return [...[...names].map((name) => `/${name}`), text]
    .filter(Boolean)
    .join(' ');
}

export function emptyState(): State {
  return {
    version: 1,
    projects: [],
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
  push: 'Push',
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
  archiveOnMerge: false,
  closeOnPush: true,
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

/** The most panes, of any type, a project can have open at once. */
export const MAX_PANES = 12;

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

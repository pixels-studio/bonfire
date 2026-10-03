/** Enough of a diff for a model to describe the change; the rest only costs time. */
const DIFF_SAMPLE_LENGTH = 24_000;

export interface PullRequestContext {
  branch: string;
  base: string;
  /** Subjects of the commits beyond the base, newest first. */
  commits: string[];
  /** Everything the branch changes beyond its base, committed or not. */
  diff: string;
}

export function pullRequestPrompt({
  branch,
  base,
  commits,
  diff,
}: PullRequestContext) {
  return [
    `Write the title and description of a pull request from \`${branch}\` into \`${base}\`.`,
    'The first line is the title: at most 72 characters, in the imperative, no trailing period.',
    'Then a blank line and the description in markdown: a short summary of what changed and why, then bullets for notable details. No headings, no preamble.',
    '',
    ...(commits.length
      ? ['<commits>', ...commits.toReversed(), '</commits>', '']
      : []),
    '<diff>',
    diff.length > DIFF_SAMPLE_LENGTH
      ? `${diff.slice(0, DIFF_SAMPLE_LENGTH)}\n… (truncated)`
      : diff,
    '</diff>',
  ].join('\n');
}

/** Splits a model's reply into the title and the description, undoing any wrapping. */
export function parsePullRequestText(
  reply: string,
): { title: string; body: string } | undefined {
  const lines = reply
    .trim()
    .replace(/^```\w*\n|\n```$/g, '')
    .trim()
    .split('\n');
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return;
  const title = lines[first]
    .replace(/^(?:title:\s*|#+\s*)/i, '')
    .replace(/^["'`*\s]+|["'`*.\s]+$/g, '');
  if (!title) return;
  return {
    title,
    body: lines
      .slice(first + 1)
      .join('\n')
      .trim(),
  };
}

/** The message that has an agent carry out an action, with the user's instructions for it. */
export function actionAgentPrompt(
  instructions: string,
  { branch, base }: Pick<PullRequestContext, 'branch' | 'base'>,
) {
  return [
    'The user likes the current state of the code.',
    '',
    `The current branch is ${branch}.`,
    `The target branch is origin/${base}.`,
    '',
    instructions.replaceAll('{branch}', branch).replaceAll('{base}', base),
  ].join('\n');
}

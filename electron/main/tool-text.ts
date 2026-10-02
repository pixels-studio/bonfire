/** Longest tool output kept in a message; the rest is elided so state and IPC stay small. */
export const MAX_TOOL_OUTPUT = 20_000;
const MAX_TOOL_INPUT = 500;

/** Keeps the start and end of long output, since errors tend to be at the end. */
export function clipOutput(text: string, max = MAX_TOOL_OUTPUT) {
  if (text.length <= max) return text;
  const head = Math.floor(max / 4);
  const tail = max - head;
  const omitted = text.length - max;
  return `${text.slice(0, head)}\n… ${omitted.toLocaleString('en-US')} characters omitted …\n${text.slice(-tail)}`;
}

function clipInput(text: string) {
  return text.length > MAX_TOOL_INPUT
    ? `${text.slice(0, MAX_TOOL_INPUT - 1)}…`
    : text;
}

/** Arguments that best describe a tool call, most telling first. */
const KEY_ARGUMENTS = [
  'command',
  'file_path',
  'notebook_path',
  'pattern',
  'url',
  'query',
  'description',
];

/** Picks the argument that best describes a tool call, falling back to its JSON input. */
export function toolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const fields = input as Record<string, unknown>;
  for (const key of KEY_ARGUMENTS)
    if (typeof fields[key] === 'string') return clipInput(fields[key]);
  return clipInput(JSON.stringify(input));
}

/**
 * The key argument of a tool call whose JSON input is still arriving, so the
 * call can be shown before it is complete. Empty until an argument appears.
 */
export function partialToolInput(json: string): string {
  for (const key of KEY_ARGUMENTS) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(
      json,
    );
    if (match) return clipInput(unescapeJson(match[1]));
  }
  return '';
}

/** Decodes the body of a JSON string that may end mid-escape. */
function unescapeJson(body: string) {
  // A cut-off escape such as a lone trailing backslash or `\u00` can't be decoded yet.
  const slashes = /\\*$/.exec(body)![0].length;
  const complete =
    slashes % 2 === 1
      ? body.slice(0, -1)
      : body.replace(/(?<!\\)\\u[0-9a-fA-F]{0,3}$/, '');
  try {
    return JSON.parse(`"${complete}"`) as string;
  } catch {
    return complete;
  }
}

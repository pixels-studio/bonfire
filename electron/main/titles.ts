import { titleFrom } from '../../shared/domain';

/** The start of the first message is plenty to name a conversation. */
const MESSAGE_SAMPLE_LENGTH = 2_000;

export function titlePrompt(message: string) {
  return [
    'Write a title of at most six words for a coding conversation that starts with the message below.',
    'Reply with the title alone: no quotes, no trailing punctuation, no preamble.',
    '',
    '<message>',
    message.slice(0, MESSAGE_SAMPLE_LENGTH),
    '</message>',
  ].join('\n');
}

/** Pulls the title out of a model's reply, which may wrap it in quotes or markdown. */
export function cleanTitle(reply: string) {
  const line = reply
    .split('\n')
    .map((text) => text.trim())
    .find(Boolean);
  const title = line
    ?.replace(/^title:\s*/i, '')
    .replace(/^["'`*#\s]+|["'`*.\s]+$/g, '');
  return title ? titleFrom(title) : undefined;
}

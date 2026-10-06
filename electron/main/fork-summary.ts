import type { ConversationMessage } from '../../shared/contracts';

/** Characters of the conversation kept for the summary; the rest only costs time. */
const TRANSCRIPT_SAMPLE_LENGTH = 24_000;

/** The user and assistant text of the conversation, in order, as a plain transcript. */
function transcript(messages: ConversationMessage[]) {
  return messages
    .filter((message) => message.kind === 'text')
    .map(
      (message) =>
        `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`,
    )
    .join('\n\n');
}

/** Asks a model to summarize a conversation so it can be handed to a different agent. */
export function forkSummaryPrompt(messages: ConversationMessage[]) {
  const text = transcript(messages);
  const sample =
    text.length > TRANSCRIPT_SAMPLE_LENGTH
      ? `… (truncated)\n${text.slice(-TRANSCRIPT_SAMPLE_LENGTH)}`
      : text;
  return [
    'Write a summary of the coding conversation below, for an agent that was not part of it but needs to continue the work.',
    'Cover what was asked, what was done, and anything left open or decided along the way. Plain prose, no headings, no preamble.',
    '',
    '<conversation>',
    sample,
    '</conversation>',
  ].join('\n');
}

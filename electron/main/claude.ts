import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import type {
  CanUseTool,
  ModelInfo,
  Options,
  PermissionResult,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKUserMessage,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  ConversationMessage,
  ModelOption,
  Pane,
  Project,
  ProviderAccount,
  ProviderLimits,
  Question,
  ReasoningEffort,
  Skill,
  Usage,
} from '../../shared/contracts';
import {
  ChatAssistant,
  assistantMessage,
  attachedText,
  inlineParts,
  type Prompt,
  type Turn,
} from './assistant';
import { Cached } from './cached';
import { Channel } from './channel';
import { claudeLimits } from './limits';
import type { Machine } from './machines';
import { clipOutput, partialToolInput, toolInput } from './tool-text';

const execFileAsync = promisify(execFile);

type ContentBlock = SDKAssistantMessage['message']['content'][number];
type ToolDetails = Parameters<CanUseTool>[2];
type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];

/** A content block being assembled from stream deltas, before its final message arrives. */
type StreamedBlock = {
  id: string;
  kind: 'text' | 'thinking' | 'tool';
  /** Tool name, for tool-use blocks. */
  name: string;
  /** A tool call's input JSON as it arrives; unused for text and thinking. */
  json: string;
  /** Set once the complete assistant message has replaced the streamed text. */
  settled: boolean;
  startedAt: number;
  /** How long a thinking block streamed, known once the block stops. */
  durationMs?: number;
};

type StreamState = {
  /** API id of the message whose stream events are arriving. */
  current: string;
  /** Streamed blocks keyed by API message id, then content-block index. */
  blocks: Map<string, Map<number, StreamedBlock>>;
  /** What the latest model call put in the context window. */
  usage?: Usage;
};

const EXTENDED_CONTEXT_MODEL = 'sonnet-1m';
const EXTENDED_CONTEXT_BETA = 'context-1m-2025-08-07';
const SESSION_TIMEOUT_MS = 20_000;
const DEFAULT_OUTPUT_STYLE = 'default';

// Newer models omit thinking text unless a summarized display is requested.
const THINKING: Record<ReasoningEffort, Options['thinking']> = {
  minimal: { type: 'disabled' },
  low: { type: 'enabled', budgetTokens: 2048, display: 'summarized' },
  medium: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
  high: { type: 'enabled', budgetTokens: 16384, display: 'summarized' },
  xhigh: { type: 'adaptive', display: 'summarized' },
};

export class ClaudeAssistant extends ChatAssistant {
  protected readonly provider = 'claude';
  private readonly styles = new Cached(
    () =>
      // User settings are read so the user's own styles are listed too.
      this.withIdleSession(
        async (run) =>
          (await run.initializationResult()).available_output_styles,
        { settingSources: ['user'] },
      ),
    60_000,
  );

  /** Output styles Claude offers, built-in and the user's own. */
  outputStyles(): Promise<string[]> {
    return this.styles.get();
  }

  protected async run(turn: Turn) {
    const { pane, project, machine, input, attachments, controller } = turn;
    const { claudeOutputStyle } = this.store.preferences;
    const options: Options = {
      cwd: project.path,
      resume: pane.threadId || undefined,
      ...modelOptions(input.model),
      thinking: THINKING[input.reasoningEffort],
      settings: {
        ...(claudeOutputStyle !== DEFAULT_OUTPUT_STYLE && {
          outputStyle: claudeOutputStyle,
        }),
        ...(input.fastMode && { fastMode: true }),
      },
      // Unattended runs approve in `canUseTool` rather than bypassing permissions, because
      // bypassing would also skip the callback that carries the model's questions to the user.
      permissionMode: 'default',
      canUseTool: (tool, toolArguments, details) =>
        this.authorize(turn, tool, toolArguments, details),
      abortController: controller,
      includePartialMessages: true,
      spawnClaudeCodeProcess: remoteSpawner(machine),
      pathToClaudeCodeExecutable: claudeExecutable(),
    };
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    // Interrupting, steering, and permission callbacks all need streaming input. The
    // input stays open until every prompt sent has been answered, then the CLI exits.
    const prompts = new Channel<SDKUserMessage>();
    const unanswered = new Set<string>();
    const submit = (prompt: Prompt, priority?: SDKUserMessage['priority']) => {
      const uuid = randomUUID();
      unanswered.add(uuid);
      prompts.push(userMessage(prompt, uuid, priority));
    };
    submit({ text: input.text, attachments, skills: turn.skills });
    // The CLI folds a message sent mid-turn into the turn between tool calls.
    turn.setSteer(async (prompt) => submit(prompt, 'next'));
    const run = query({ prompt: prompts, options });
    turn.setInterrupt(async () => {
      await run.interrupt();
    });
    const state: StreamState = { current: '', blocks: new Map() };
    try {
      for await (const event of run) {
        this.handle(turn, event, state);
        if (event.type !== 'result') continue;
        // A stop also drops steered messages the CLI still holds, which it would otherwise run.
        if (turn.cancelled) break;
        // Older CLIs don't say which prompts a result answers; theirs answers them all.
        for (const uuid of event.user_message_uuids ?? [...unanswered])
          unanswered.delete(uuid);
        if (unanswered.size) continue;
        turn.setSteer(undefined);
        prompts.close();
      }
    } finally {
      turn.setSteer(undefined);
      prompts.close();
    }
  }

  protected listModels(): Promise<ModelOption[]> {
    return this.withIdleSession(async (run) =>
      modelList(await run.supportedModels()),
    );
  }

  /** The CLI's skills and prompt commands: the user's, the project's, plugins', and its own. */
  protected listSkills(project: Project, machine: Machine): Promise<Skill[]> {
    return this.withIdleSession(
      async (run) =>
        (await run.supportedCommands())
          // Internal commands, and ones the CLI keeps only to say they are gone.
          .filter(
            ({ name, description }) =>
              !name.startsWith('__') && !description.startsWith('(removed)'),
          )
          .map(({ name, description, argumentHint }) => ({
            name,
            description,
            argumentHint: argumentHint || undefined,
          })),
      {
        cwd: project.path,
        settingSources: ['user', 'project', 'local'],
        spawnClaudeCodeProcess: remoteSpawner(machine),
      },
    );
  }

  protected readAccount(): Promise<ProviderAccount> {
    return this.withIdleSession(async (run) => {
      const info = await run.accountInfo();
      const viaApiKey = !!info.apiKeySource && info.apiKeySource !== 'none';
      return {
        provider: 'claude',
        signedIn: !!info.email || viaApiKey,
        email: info.email,
        plan: info.subscriptionType ?? (viaApiKey ? 'API key' : undefined),
      };
    });
  }

  /** Runs the CLI's own browser sign-in, which saves the new credentials where the SDK reads them. */
  protected async signIn(signal: AbortSignal) {
    try {
      await execFileAsync(claudeExecutable(), ['auth', 'login', '--claudeai'], {
        signal,
      });
    } catch (cause) {
      if (signal.aborted) throw Error('Sign-in was cancelled.');
      throw cause;
    }
  }

  protected async complete(prompt: string, model: string, signal: AbortSignal) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const controller = new AbortController();
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    const run = query({
      prompt,
      options: {
        ...modelOptions(model),
        abortController: controller,
        tools: [],
        settingSources: [],
        maxTurns: 1,
        thinking: { type: 'disabled' },
        // Generated text isn't a conversation the user would want to resume.
        persistSession: false,
        pathToClaudeCodeExecutable: claudeExecutable(),
      },
    });
    try {
      for await (const event of run) {
        if (event.type !== 'result') continue;
        if (event.subtype === 'success' && !event.is_error) return event.result;
        throw Error('Claude could not generate text');
      }
    } finally {
      run.close();
    }
    throw Error('Claude returned no text');
  }

  protected readLimits(): Promise<ProviderLimits> {
    return this.withIdleSession(async (run) =>
      claudeLimits(
        await run.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true,
        }),
      ),
    );
  }

  /** Runs `use` against a session that never receives a message, as the handshake alone answers it. */
  private async withIdleSession<Result>(
    use: (run: Query) => Promise<Result>,
    options: Pick<
      Options,
      'settingSources' | 'cwd' | 'spawnClaudeCodeProcess'
    > = { settingSources: [] },
  ): Promise<Result> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const controller = new AbortController();
    const idle = (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise((resolve) =>
        controller.signal.addEventListener('abort', resolve),
      );
    })();
    const run = query({
      prompt: idle,
      options: {
        abortController: controller,
        tools: [],
        pathToClaudeCodeExecutable: claudeExecutable(),
        ...options,
      },
    });
    const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
      return await use(run);
    } finally {
      clearTimeout(timeout);
      controller.abort();
      run.close();
    }
  }

  /** Asks the user before the model uses a tool, unless the pane runs unattended. */
  private async authorize(
    turn: Turn,
    tool: string,
    toolArguments: Record<string, unknown>,
    details: ToolDetails,
  ): Promise<PermissionResult> {
    if (tool === 'AskUserQuestion')
      return this.askQuestions(turn, toolArguments);
    if (turn.approvals === 'auto')
      return { behavior: 'allow', updatedInput: toolArguments };

    const answer = await this.ask(turn.pane, {
      kind: 'approval',
      title:
        details.title ?? `Claude wants to use ${details.displayName ?? tool}`,
      detail: toolInput(toolArguments),
      reason: details.description ?? details.decisionReason,
      canRemember: !!details.suggestions?.length,
    });
    if (!answer) return stopped();
    if (!('decision' in answer) || answer.decision === 'deny')
      return { behavior: 'deny', message: 'The user declined this action.' };
    return {
      behavior: 'allow',
      updatedInput: toolArguments,
      updatedPermissions:
        answer.decision === 'allow-session' ? details.suggestions : undefined,
    };
  }

  private async askQuestions(
    turn: Turn,
    toolArguments: Record<string, unknown>,
  ): Promise<PermissionResult> {
    const asked = (toolArguments.questions ?? []) as {
      question: string;
      header: string;
      options: { label: string; description?: string }[];
      multiSelect?: boolean;
    }[];
    const questions: Question[] = asked.map((item, index) => ({
      id: String(index),
      header: item.header,
      question: item.question,
      options: item.options.map(({ label, description }) => ({
        label,
        description,
      })),
      multiple: !!item.multiSelect,
    }));
    const answer = await this.ask(turn.pane, { kind: 'question', questions });
    if (!answer) return stopped();
    if (!('answers' in answer))
      return { behavior: 'deny', message: 'The user declined to answer.' };
    return {
      behavior: 'allow',
      updatedInput: {
        ...toolArguments,
        // The tool expects each answer keyed by its question text; multiple choices are comma-joined.
        answers: Object.fromEntries(
          questions.map(({ id, question }) => [
            question,
            (answer.answers[id] ?? []).join(', '),
          ]),
        ),
      },
    };
  }

  private handle(turn: Turn, event: SDKMessage, state: StreamState) {
    const { pane } = turn;
    switch (event.type) {
      case 'system':
        // The session id is known up front, so a turn stopped early can still be resumed.
        if (event.subtype === 'init')
          this.rememberThread(pane, event.session_id);
        else if (event.subtype === 'compact_boundary')
          this.publish(
            pane,
            assistantMessage(randomUUID(), 'notice', 'Context compacted'),
          );
        break;
      case 'stream_event':
        // Subagent output isn't rendered, so its deltas aren't either.
        if (!event.parent_tool_use_id)
          this.handleStream(pane, event.event, state);
        break;
      case 'assistant': {
        if (event.parent_tool_use_id) break;
        if (event.session_id) this.rememberThread(pane, event.session_id);
        const blocks = event.message.content;
        const apiBlocks = state.blocks.get(event.message.id);
        blocks.forEach((block, index) => {
          const kind = blockKind(block);
          const match =
            kind &&
            [...(apiBlocks?.values() ?? [])].find(
              (item) =>
                !item.settled &&
                item.kind === kind &&
                (block.type !== 'tool_use' || item.id === block.id),
            );
          if (match) match.settled = true;
          const id =
            match?.id ??
            (blocks.length > 1 ? `${event.uuid}-${index}` : event.uuid);
          const message = messageFrom(id, block);
          if (message)
            this.publish(pane, { ...message, durationMs: match?.durationMs });
        });
        break;
      }
      case 'user':
        if (!event.parent_tool_use_id) this.attachToolResults(pane, event);
        break;
      case 'result': {
        if (state.usage) {
          const windows = Object.values(event.modelUsage ?? {}).map(
            (model) => model.contextWindow,
          );
          this.publishUsage(pane, {
            ...state.usage,
            contextWindow: windows.length ? Math.max(...windows) : undefined,
          });
        }
        if (turn.cancelled) break;
        if (event.subtype !== 'success')
          this.publishError(
            pane,
            event.errors.join('\n') || 'Claude turn failed',
          );
        else if (event.is_error)
          this.publishError(pane, event.result || 'Claude turn failed');
        break;
      }
    }
  }

  /** Publishes in-progress text, thinking, and tool input as deltas arrive. */
  private handleStream(pane: Pane, event: StreamEvent, state: StreamState) {
    switch (event.type) {
      case 'message_start': {
        state.blocks.set(event.message.id, new Map());
        state.current = event.message.id;
        const { usage } = event.message;
        state.usage = {
          inputTokens: usage.input_tokens ?? 0,
          cachedInputTokens:
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
          // Thinking is billed as output and isn't reported separately.
          reasoningOutputTokens: 0,
        };
        break;
      }
      case 'message_delta':
        if (state.usage) {
          state.usage = {
            ...state.usage,
            outputTokens: event.usage.output_tokens ?? state.usage.outputTokens,
          };
          this.publishUsage(pane, state.usage);
        }
        break;
      case 'content_block_start': {
        const { content_block: block, index } = event;
        const kind = blockKind(block);
        const blocks = state.blocks.get(state.current);
        if (!kind || !blocks) break;
        const entry: StreamedBlock = {
          id: block.type === 'tool_use' ? block.id : randomUUID(),
          kind,
          name: block.type === 'tool_use' ? block.name : '',
          json: '',
          settled: false,
          startedAt: Date.now(),
        };
        blocks.set(index, entry);
        this.publish(pane, streamingMessage(entry, ''), false);
        break;
      }
      case 'content_block_stop': {
        const entry = state.blocks.get(state.current)?.get(event.index);
        if (entry?.kind === 'thinking')
          entry.durationMs = Date.now() - entry.startedAt;
        break;
      }
      case 'content_block_delta': {
        const entry = state.blocks.get(state.current)?.get(event.index);
        if (!entry) break;
        const { delta } = event;
        if (delta.type === 'text_delta')
          this.append(pane, entry.id, 'text', delta.text);
        else if (delta.type === 'thinking_delta')
          this.append(pane, entry.id, 'text', delta.thinking);
        else if (delta.type === 'input_json_delta') {
          entry.json += delta.partial_json;
          const input = partialToolInput(entry.json);
          const current = pane.messages.findLast(
            (item) => item.id === entry.id,
          );
          // The call is shown as soon as its key argument appears, not once it is complete.
          if (input && current?.tool && current.tool.input !== input)
            this.publish(
              pane,
              { ...current, tool: { ...current.tool, input } },
              false,
            );
        }
        break;
      }
    }
  }

  /** Attaches tool output to the matching tool-use message and settles its status. */
  private attachToolResults(
    pane: Pane,
    event: Extract<SDKMessage, { type: 'user' }>,
  ) {
    const { content } = event.message;
    if (typeof content === 'string') return;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const toolMessage = pane.messages.findLast(
        (message) => message.id === block.tool_use_id,
      );
      if (!toolMessage?.tool) continue;
      const output = clipOutput(resultText(block.content));
      this.publish(pane, {
        ...toolMessage,
        status: block.is_error ? 'failed' : 'complete',
        tool: { ...toolMessage.tool, output },
      });
    }
  }
}

/** Flattens a tool result's content, noting images that can't be shown. */
function resultText(
  content: string | { type: string; text?: string }[] | undefined,
): string {
  if (typeof content === 'string') return content;
  return (content ?? [])
    .map((part) => part.text ?? (part.type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join('\n');
}

/** The refusal returned when the turn ended while the model was waiting on the user. */
function stopped(): PermissionResult {
  return {
    behavior: 'deny',
    message: 'The user stopped the turn before answering.',
    interrupt: true,
  };
}

/**
 * The message text with its skills. The CLI runs a skill named at the start of a message,
 * so the first leads; the model loads any others with its Skill tool.
 */
export function skillText(text: string, skills: Pick<Skill, 'name'>[]) {
  const [first, ...rest] = skills;
  if (!first) return text;
  const also = rest.length
    ? `Also use the ${rest.map(({ name }) => `/${name}`).join(', ')} skill${rest.length > 1 ? 's' : ''}.`
    : '';
  return [`/${first.name}`, text, also].filter(Boolean).join(' ');
}

function userMessage(
  { text, attachments, skills }: Prompt,
  uuid: SDKUserMessage['uuid'],
  priority?: SDKUserMessage['priority'],
): SDKUserMessage {
  return {
    type: 'user',
    uuid,
    parent_tool_use_id: null,
    priority,
    message: {
      role: 'user',
      content: inlineParts(skillText(text, skills), attachments).flatMap(
        (part) => {
          if ('text' in part)
            return part.text.trim()
              ? [{ type: 'text' as const, text: part.text }]
              : [];
          const { attachment } = part;
          return attachment.kind === 'image'
            ? [
                {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: attachment.mimeType,
                    data: attachment.base64,
                  },
                },
              ]
            : [{ type: 'text' as const, text: attachedText(attachment) }];
        },
      ),
    },
  };
}

/** The SDK model for a picker value; the 1M-context Sonnet is Sonnet with a beta. */
function modelOptions(model: string): Pick<Options, 'model' | 'betas'> {
  if (model === EXTENDED_CONTEXT_MODEL)
    return { model: 'sonnet', betas: [EXTENDED_CONTEXT_BETA] };
  return { model: model && model !== 'default' ? model : undefined };
}

/**
 * The CLI binary bundled with the SDK; the installed `claude` otherwise, as in the packaged
 * app, which leaves the bundled binary out. Both keep credentials in the same place.
 */
function claudeExecutable() {
  const require = createRequire(__filename);
  const executable = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const variants = process.platform === 'linux' ? ['', '-musl'] : [''];
  for (const variant of variants)
    try {
      return require.resolve(
        `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${variant}/${executable}`,
      );
    } catch {
      // Not installed for this platform; try the next.
    }
  return 'claude';
}

/** How the SDK starts the CLI: the remote machine's own, or the bundled one by default. */
function remoteSpawner(machine: Machine): Options['spawnClaudeCodeProcess'] {
  return machine.remote ? (spawn) => spawnRemote(machine, spawn) : undefined;
}

/**
 * Runs the `claude` installed on a remote machine with the arguments the SDK chose. Only
 * the variables the SDK set are passed on; the rest of this computer's environment
 * doesn't belong there.
 */
function spawnRemote(
  machine: Machine,
  { args, cwd, env, signal }: SpawnOptions,
) {
  // A JavaScript build of the CLI comes as a script argument to node.
  const cliArgs = /\.m?js$/.test(args[0] ?? '') ? args.slice(1) : args;
  const added = Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        entry[1] !== process.env[entry[0]] &&
        !LOCAL_ONLY_VARIABLES.has(entry[0]),
    ),
  );
  const child = machine.spawn('claude', cliArgs, { cwd, env: added });
  signal.addEventListener('abort', () => child.kill(), { once: true });
  return child;
}

/** Variables that describe this computer and would mislead a remote CLI. */
const LOCAL_ONLY_VARIABLES = new Set([
  'PATH',
  'HOME',
  'PWD',
  'SHELL',
  'TMPDIR',
]);

/** Keeps the model aliases (opus, sonnet, …) and offers the 1M-context Sonnet beside Sonnet. */
export function modelList(models: ModelInfo[]): ModelOption[] {
  const options: ModelOption[] = models
    .filter(({ value }) => value !== 'default' && !value.startsWith('claude-'))
    .map(({ value, displayName, supportsFastMode }) => ({
      value,
      label: displayName,
      supportsFast: !!supportsFastMode,
    }));
  const sonnet = options.find(({ value }) => value === 'sonnet');
  if (!sonnet) return options;
  options.splice(options.indexOf(sonnet) + 1, 0, {
    value: EXTENDED_CONTEXT_MODEL,
    label: `${sonnet.label} (1M)`,
    contextWindow: 1_000_000,
    supportsFast: sonnet.supportsFast,
  });
  return options;
}

function blockKind(block: { type: string }): StreamedBlock['kind'] | undefined {
  switch (block.type) {
    case 'text':
      return 'text';
    case 'thinking':
      return 'thinking';
    case 'tool_use':
      return 'tool';
  }
}

function streamingMessage(
  entry: StreamedBlock,
  text: string,
): ConversationMessage {
  if (entry.kind !== 'tool')
    return assistantMessage(entry.id, entry.kind, text, 'streaming');
  return {
    ...assistantMessage(entry.id, 'tool', entry.name, 'streaming'),
    tool: { name: entry.name, input: '', output: '' },
  };
}

function messageFrom(
  id: string,
  block: ContentBlock,
): ConversationMessage | undefined {
  switch (block.type) {
    case 'text':
      return assistantMessage(id, 'text', block.text);
    case 'thinking':
      return assistantMessage(id, 'thinking', block.thinking);
    case 'tool_use': {
      // Keyed by the tool-use id so the later tool_result can find it.
      const input = toolInput(block.input);
      return {
        ...assistantMessage(
          block.id,
          'tool',
          `${block.name} ${input}`.trim(),
          'streaming',
        ),
        tool: { name: block.name, input, output: '' },
      };
    }
  }
}

import { tmpdir } from 'node:os';
import type {
  AssistantEvent,
  ModelOption,
  Project,
  ProviderAccount,
  ProviderLimits,
  Question,
  Skill,
} from '../../shared/contracts';
import { errorMessage, withSkillNames } from '../../shared/domain';
import {
  ChatAssistant,
  attachedText,
  inlineParts,
  type AssistantHost,
  type PendingAttachment,
  type Prompt,
  type RequestAnswer,
  type Turn,
} from './assistant';
import { displayCommand, messageFromItem, planMessage } from './codex-items';
import type {
  CodexAccount,
  CommandApprovalDecision,
  LoginCompleted,
  ModelEntry,
  RequestId,
  SkillsListEntry,
  ThreadItem,
  TokenUsageBreakdown,
  TurnStatus,
  UserInputQuestion,
} from './codex-protocol';
import { codexLimits, type CodexRateLimits } from './limits';
import { localMachine, type Machine } from './machines';
import { CodexRpc, codexCommand, type CodexCommand } from './codex-rpc';
import type { Store } from './persistence';

/** If Codex sends nothing for this long, the turn is assumed hung and ended. */
const SILENCE_LIMIT_MS = 10 * 60_000;

/** One turn in progress on a Codex thread. */
type Run = {
  turn: Turn;
  rpc: CodexRpc;
  /** The machine whose server runs the turn. */
  machine: Machine;
  threadId: string;
  /** Known once the turn starts; notifications for other turns on the thread are ignored. */
  turnId?: string;
  /** Interrupt asked for before the turn had an id. */
  interruptPending: boolean;
  /** Highest summary section seen per reasoning item, to separate sections. */
  summaryIndex: Map<string, number>;
  /** When each reasoning item started, to time it once it completes. */
  reasoningStarts: Map<string, number>;
  settle: { resolve: () => void; reject: (error: Error) => void };
  finished: boolean;
  /** Whether this turn has already shown its failure. */
  reported: boolean;
  silence?: NodeJS.Timeout;
};

/** A one-off completion on an ephemeral thread. */
type Generation = {
  text: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

/**
 * Talks to one long-lived `codex app-server`, which multiplexes conversations as
 * threads. The app server (unlike `codex exec`) streams text deltas, asks the
 * client to approve commands and edits, and can interrupt a turn cleanly.
 */
export class CodexAssistant extends ChatAssistant {
  protected readonly provider = 'codex';
  /** App servers by machine id. */
  private readonly servers = new Map<string, Promise<CodexRpc>>();
  private readonly runs = new Map<string, Run>();
  private readonly generations = new Map<string, Generation>();
  /** Sign-ins waiting for the browser, keyed by login id. */
  private readonly logins = new Map<string, (result: LoginCompleted) => void>();

  constructor(
    store: Store,
    emit: (event: AssistantEvent) => void,
    host: AssistantHost,
    private readonly command: (machine: Machine) => CodexCommand = codexCommand,
  ) {
    super(store, emit, host);
  }

  protected async run(turn: Turn) {
    const { pane, project, machine, input, attachments } = turn;
    const rpc = await this.connection(machine);
    const auto = turn.approvals === 'auto';
    const settings = {
      model: input.model || undefined,
      cwd: project.path,
      // The sandbox keeps writes inside the project; "on-request" asks before leaving it.
      approvalPolicy: auto ? 'never' : 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    };
    const threadId = pane.threadId
      ? (
          await rpc.request<{ thread: { id: string } }>('thread/resume', {
            threadId: pane.threadId,
            ...settings,
          })
        ).thread.id
      : (
          await rpc.request<{ thread: { id: string } }>(
            'thread/start',
            settings,
          )
        ).thread.id;
    this.rememberThread(pane, threadId);

    let run!: Run;
    const finished = new Promise<void>((resolve, reject) => {
      run = {
        turn,
        rpc,
        machine,
        threadId,
        interruptPending: false,
        summaryIndex: new Map(),
        reasoningStarts: new Map(),
        settle: { resolve, reject },
        finished: false,
        reported: false,
      };
    });
    // Registered before the turn starts so none of its notifications are missed.
    this.runs.set(threadId, run);
    turn.setInterrupt(() => this.interrupt(run));
    turn.controller.signal.addEventListener('abort', () => this.finish(run));
    this.watch(run);
    const { codexPersonality } = this.store.preferences;
    try {
      const started = await rpc.request<{ turn: { id: string } }>(
        'turn/start',
        {
          threadId,
          input: userInput(
            { text: input.text, attachments, skills: turn.skills },
            machine,
          ),
          effort: input.reasoningEffort,
          // Without this the model's reasoning isn't summarized, so there is nothing to show.
          summary: 'auto',
          personality:
            codexPersonality === 'default' ? undefined : codexPersonality,
        },
      );
      run.turnId ??= started.turn.id;
      if (run.interruptPending) void this.interrupt(run).catch(() => {});
      else if (!run.finished)
        turn.setSteer((prompt) => this.steer(run, prompt));
      await finished;
    } finally {
      clearTimeout(run.silence);
      this.runs.delete(threadId);
    }
  }

  protected async listModels(): Promise<ModelOption[]> {
    const rpc = await this.connection();
    const models: ModelOption[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: ModelEntry[]; nextCursor: string | null } =
        await rpc.request('model/list', { cursor });
      for (const { model, displayName, hidden } of page.data)
        if (!hidden) models.push({ value: model, label: displayName });
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  }

  /** Enabled skills for the project's folder: its own, the user's, plugins', and Codex's. */
  protected async listSkills(
    project: Project,
    machine: Machine,
  ): Promise<Skill[]> {
    const rpc = await this.connection(machine);
    const { data } = await rpc.request<{ data: SkillsListEntry[] }>(
      'skills/list',
      { cwds: [project.path] },
    );
    const skills = new Map<string, Skill>();
    for (const entry of data)
      for (const skill of entry.skills)
        if (skill.enabled && !skills.has(skill.name))
          skills.set(skill.name, {
            name: skill.name,
            description:
              skill.interface?.shortDescription ??
              skill.shortDescription ??
              skill.description,
            path: skill.path,
          });
    return [...skills.values()];
  }

  protected async readLimits(): Promise<ProviderLimits> {
    const rpc = await this.connection();
    return codexLimits(
      await rpc.request<CodexRateLimits>('account/rateLimits/read', undefined),
    );
  }

  protected async readAccount(): Promise<ProviderAccount> {
    const rpc = await this.connection();
    const { account } = await rpc.request<{ account: CodexAccount | null }>(
      'account/read',
      {},
    );
    if (!account) return { provider: 'codex', signedIn: false };
    if (account.type === 'chatgpt')
      return {
        provider: 'codex',
        signedIn: true,
        email: account.email ?? undefined,
        plan: account.planType,
      };
    return {
      provider: 'codex',
      signedIn: true,
      plan: account.type === 'apiKey' ? 'API key' : 'Amazon Bedrock',
    };
  }

  /** Starts a ChatGPT sign-in, opens it in the browser, and waits for the server to finish it. */
  protected async signIn(signal: AbortSignal) {
    const rpc = await this.connection();
    const { loginId, authUrl } = await rpc.request<{
      loginId: string;
      authUrl: string;
    }>('account/login/start', { type: 'chatgpt' });
    const completed = new Promise<LoginCompleted>((resolve) =>
      this.logins.set(loginId, resolve),
    );
    const aborted = new Promise<never>((_, reject) =>
      signal.addEventListener(
        'abort',
        () => reject(Error('Sign-in was cancelled.')),
        { once: true },
      ),
    );
    try {
      await this.host.openUrl(authUrl);
      const result = await Promise.race([completed, aborted]);
      if (!result.success) throw Error(result.error ?? 'Sign-in failed.');
    } catch (cause) {
      if (signal.aborted)
        void rpc.request('account/login/cancel', { loginId }).catch(() => {});
      throw cause;
    } finally {
      this.logins.delete(loginId);
    }
  }

  /** Runs the prompt on an ephemeral, read-only thread that isn't saved to the user's history. */
  protected async complete(prompt: string, model: string, signal: AbortSignal) {
    const rpc = await this.connection();
    const { thread } = await rpc.request<{ thread: { id: string } }>(
      'thread/start',
      {
        model,
        cwd: tmpdir(),
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox: 'read-only',
      },
    );
    try {
      return await new Promise<string>((resolve, reject) => {
        this.generations.set(thread.id, { text: '', resolve, reject });
        const started = rpc.request<{ turn: { id: string } }>('turn/start', {
          threadId: thread.id,
          input: userInput({ text: prompt, attachments: [], skills: [] }),
        });
        started.catch(reject);
        signal.addEventListener(
          'abort',
          () => {
            reject(Error('Codex took too long to generate text'));
            void started
              .then(({ turn }) =>
                rpc.request('turn/interrupt', {
                  threadId: thread.id,
                  turnId: turn.id,
                }),
              )
              .catch(() => {});
          },
          { once: true },
        );
      });
    } finally {
      this.generations.delete(thread.id);
    }
  }

  close() {
    super.close();
    const servers = [...this.servers.values()];
    this.servers.clear();
    for (const server of servers)
      void server.then((rpc) => rpc.close()).catch(() => {});
  }

  /**
   * The machine's shared server, started on first use and again if it dies. Accounts,
   * models, and text generation use the one on this computer.
   */
  private connection(machine: Machine = localMachine): Promise<CodexRpc> {
    const known = this.servers.get(machine.id);
    if (known) return known;
    const forget = () => {
      if (this.servers.get(machine.id) === server)
        this.servers.delete(machine.id);
    };
    const server: Promise<CodexRpc> = CodexRpc.start(this.command(machine), {
      onNotification: (method, params) => {
        if (method === 'account/login/completed')
          return this.logins.get(params.loginId)?.(params);
        const run = this.runs.get(params?.threadId);
        if (run) return this.notification(run, method, params);
        const generation = this.generations.get(params?.threadId);
        if (generation) generationNotification(generation, method, params);
      },
      onRequest: (id, method, params) =>
        void this.request(id, method, params, server),
      onExit: (error) => {
        forget();
        for (const run of this.runs.values())
          if (run.machine.id === machine.id) this.fail(run, error);
        if (!machine.remote)
          for (const generation of this.generations.values())
            generation.reject(error);
      },
    });
    // A failed start must not be remembered, or every later turn would fail the same way.
    server.catch(forget);
    this.servers.set(machine.id, server);
    return server;
  }

  private async steer(run: Run, prompt: Prompt) {
    await run.rpc.request('turn/steer', {
      threadId: run.threadId,
      expectedTurnId: run.turnId,
      input: userInput(prompt, run.machine),
    });
  }

  private async interrupt(run: Run) {
    if (!run.turnId) {
      run.interruptPending = true;
      return;
    }
    await run.rpc.request('turn/interrupt', {
      threadId: run.threadId,
      turnId: run.turnId,
    });
  }

  /** Ends the turn if the server goes quiet, as it would if it hung. */
  private watch(run: Run) {
    clearTimeout(run.silence);
    run.silence = setTimeout(() => {
      void this.interrupt(run).catch(() => {});
      this.fail(run, Error('Codex stopped responding'));
    }, SILENCE_LIMIT_MS);
  }

  private finish(run: Run) {
    if (run.finished) return;
    run.finished = true;
    run.turn.setSteer(undefined);
    run.settle.resolve();
  }

  private fail(run: Run, error: Error) {
    if (run.finished) return;
    run.finished = true;
    run.turn.setSteer(undefined);
    run.settle.reject(error);
  }

  private notification(run: Run, method: string, params: any) {
    this.watch(run);
    const { pane } = run.turn;
    // Notifications about other turns on this thread aren't part of this one.
    const turnId: string | undefined = params.turnId ?? params.turn?.id;
    if (run.turnId && turnId && turnId !== run.turnId) return;

    switch (method) {
      case 'turn/started':
        run.turnId ??= params.turn.id;
        break;
      case 'item/started':
      case 'item/completed': {
        const completed = method === 'item/completed';
        const item = params.item as ThreadItem;
        const message = messageFromItem(item, completed);
        if (message && item.type === 'reasoning') {
          const startedAt = run.reasoningStarts.get(item.id) ?? Date.now();
          run.reasoningStarts.set(item.id, startedAt);
          if (completed) message.durationMs = Date.now() - startedAt;
        }
        if (message) this.publish(pane, message, completed);
        break;
      }
      case 'item/agentMessage/delta':
        this.append(pane, params.itemId, 'text', params.delta);
        break;
      case 'item/reasoning/summaryTextDelta': {
        // Each summary section starts a new paragraph.
        const section: number = params.summaryIndex;
        const previous = run.summaryIndex.get(params.itemId) ?? section;
        run.summaryIndex.set(params.itemId, section);
        this.append(
          pane,
          params.itemId,
          'text',
          (section > previous ? '\n\n' : '') + params.delta,
        );
        break;
      }
      case 'item/commandExecution/outputDelta':
        this.append(pane, params.itemId, 'output', params.delta);
        break;
      case 'turn/plan/updated':
        this.publish(pane, planMessage(params.turnId, params.plan), false);
        break;
      case 'thread/tokenUsage/updated': {
        const last: TokenUsageBreakdown = params.tokenUsage.last;
        this.publishUsage(pane, {
          // Cached and reasoning tokens are counted inside input and output, so split them out.
          inputTokens: Math.max(0, last.inputTokens - last.cachedInputTokens),
          cachedInputTokens: last.cachedInputTokens,
          outputTokens: Math.max(
            0,
            last.outputTokens - last.reasoningOutputTokens,
          ),
          reasoningOutputTokens: last.reasoningOutputTokens,
          contextWindow: params.tokenUsage.modelContextWindow ?? undefined,
        });
        break;
      }
      case 'error':
        // A retry follows, so this isn't the end of the turn.
        if (!params.willRetry && !run.turn.cancelled) {
          run.reported = true;
          this.publishError(pane, readableError(params.error.message));
        }
        break;
      case 'turn/completed': {
        const { status, error } = params.turn as {
          status: TurnStatus;
          error: { message: string } | null;
        };
        // Failures are reported by `error` first; this covers one that wasn't.
        if (status === 'failed' && !run.turn.cancelled && !run.reported)
          this.publishError(
            pane,
            readableError(error?.message ?? 'Codex turn failed'),
          );
        this.finish(run);
        break;
      }
    }
  }

  /** Answers the server's requests for approval or input, which wait on the user. */
  private async request(
    id: RequestId,
    method: string,
    params: any,
    server: Promise<CodexRpc>,
  ) {
    const rpc = await server;
    const run = this.runs.get(params?.threadId);
    if (!run) return rpc.respondError(id, 'No turn is waiting on this');
    const { pane } = run.turn;
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval': {
          const answer = await this.ask(pane, {
            kind: 'approval',
            title: params.networkApprovalContext
              ? `Allow network access to ${params.networkApprovalContext.host}`
              : 'Run command',
            detail: displayCommand(params.command ?? ''),
            reason: params.reason ?? undefined,
            canRemember: true,
          });
          return rpc.respond(id, { decision: decisionFor(answer) });
        }
        case 'item/fileChange/requestApproval': {
          const edit = pane.messages.findLast(
            (item) => item.id === params.itemId,
          );
          const answer = await this.ask(pane, {
            kind: 'approval',
            title: 'Apply file changes',
            detail: edit?.tool?.input || params.grantRoot || '',
            reason: params.reason ?? undefined,
            canRemember: true,
          });
          return rpc.respond(id, { decision: decisionFor(answer) });
        }
        case 'item/tool/requestUserInput': {
          const asked: UserInputQuestion[] = params.questions;
          const questions: Question[] = asked.map((item) => ({
            id: item.id,
            header: item.header,
            question: item.question,
            options: item.options ?? [],
            multiple: false,
          }));
          const answer = await this.ask(pane, { kind: 'question', questions });
          // An unanswered question is sent back empty so the turn can carry on.
          const answers = answer && 'answers' in answer ? answer.answers : {};
          return rpc.respond(id, {
            answers: Object.fromEntries(
              questions.map(({ id: questionId }) => [
                questionId,
                { answers: answers[questionId] ?? [] },
              ]),
            ),
          });
        }
        default:
          return rpc.respondError(id, `Unsupported request: ${method}`);
      }
    } catch (cause) {
      rpc.respondError(id, errorMessage(cause));
    }
  }
}

/** One part of a Codex prompt: text, or an image inline or on disk. */
type InputPart =
  | { type: 'text'; text: string; text_elements: never[] }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string };

/**
 * A prompt as Codex input. Images on this computer go by path, and inline to a remote
 * machine. Skills go by the path the server listed them at, which is on its own machine.
 */
function userInput(
  { text, attachments, skills }: Prompt,
  machine: Machine = localMachine,
) {
  return [
    ...inlineParts(withSkillNames(text), attachments).flatMap(
      (part): InputPart[] => {
        if ('text' in part)
          return part.text.trim()
            ? [{ type: 'text', text: part.text, text_elements: [] }]
            : [];
        const attachment: PendingAttachment = part.attachment;
        if (attachment.kind !== 'image')
          return [
            {
              type: 'text',
              text: attachedText(attachment),
              text_elements: [],
            },
          ];
        return [
          machine.remote
            ? {
                type: 'image',
                url: `data:${attachment.mimeType};base64,${attachment.base64}`,
              }
            : { type: 'localImage', path: attachment.path },
        ];
      },
    ),
    ...skills
      .filter((skill) => skill.path)
      .map(({ name, path }) => ({ type: 'skill', name, path })),
  ];
}

function generationNotification(
  generation: Generation,
  method: string,
  params: any,
) {
  if (method === 'item/completed' && params.item.type === 'agentMessage')
    generation.text = params.item.text;
  else if (method === 'turn/completed') {
    if (params.turn.status === 'completed') generation.resolve(generation.text);
    else
      generation.reject(
        Error(
          readableError(
            params.turn.error?.message ?? 'Codex could not generate text',
          ),
        ),
      );
  }
}

function decisionFor(
  answer: RequestAnswer | undefined,
): CommandApprovalDecision {
  if (!answer) return 'cancel';
  if (!('decision' in answer)) return 'decline';
  return answer.decision === 'allow'
    ? 'accept'
    : answer.decision === 'allow-session'
      ? 'acceptForSession'
      : 'decline';
}

/** Errors arrive as the raw API response body; the message inside is what a person wants. */
function readableError(raw: string) {
  try {
    const body = JSON.parse(raw);
    return body.error?.message ?? body.message ?? raw;
  } catch {
    return raw;
  }
}

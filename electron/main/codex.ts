import type {
  AssistantEvent,
  ModelOption,
  ProviderLimits,
  Question,
} from '../../shared/contracts';
import { errorMessage } from '../../shared/domain';
import {
  ChatAssistant,
  type ChooseImage,
  type RequestAnswer,
  type Turn,
} from './assistant';
import { displayCommand, messageFromItem, planMessage } from './codex-items';
import type {
  CommandApprovalDecision,
  ModelEntry,
  RequestId,
  ThreadItem,
  TokenUsageBreakdown,
  TurnStatus,
  UserInputQuestion,
} from './codex-protocol';
import { codexLimits, type CodexRateLimits } from './limits';
import { CodexRpc, codexCommand, type CodexCommand } from './codex-rpc';
import type { Store } from './persistence';

/** If Codex sends nothing for this long, the turn is assumed hung and ended. */
const SILENCE_LIMIT_MS = 10 * 60_000;

/** One turn in progress on a Codex thread. */
type Run = {
  turn: Turn;
  rpc: CodexRpc;
  threadId: string;
  /** Known once the turn starts; notifications for other turns on the thread are ignored. */
  turnId?: string;
  /** Interrupt asked for before the turn had an id. */
  interruptPending: boolean;
  /** Highest summary section seen per reasoning item, to separate sections. */
  summaryIndex: Map<string, number>;
  settle: { resolve: () => void; reject: (error: Error) => void };
  finished: boolean;
  /** Whether this turn has already shown its failure. */
  reported: boolean;
  silence?: NodeJS.Timeout;
};

/**
 * Talks to one long-lived `codex app-server`, which multiplexes conversations as
 * threads. The app server (unlike `codex exec`) streams text deltas, asks the
 * client to approve commands and edits, and can interrupt a turn cleanly.
 */
export class CodexAssistant extends ChatAssistant {
  protected readonly provider = 'codex';
  private server?: Promise<CodexRpc>;
  private readonly runs = new Map<string, Run>();

  constructor(
    store: Store,
    emit: (event: AssistantEvent) => void,
    chooseImage: ChooseImage,
    private readonly command: () => CodexCommand = codexCommand,
  ) {
    super(store, emit, chooseImage);
  }

  protected async run(turn: Turn) {
    const { pane, session, input, attachments } = turn;
    const rpc = await this.connect();
    const auto = turn.approvals === 'auto';
    const settings = {
      model: input.model || undefined,
      cwd: session.worktreePath,
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
        threadId,
        interruptPending: false,
        summaryIndex: new Map(),
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
    try {
      const started = await rpc.request<{ turn: { id: string } }>(
        'turn/start',
        {
          threadId,
          input: [
            { type: 'text', text: input.text, text_elements: [] },
            ...attachments.map(({ path }) => ({ type: 'localImage', path })),
          ],
          effort: input.reasoningEffort,
          // Without this the model's reasoning isn't summarized, so there is nothing to show.
          summary: 'auto',
        },
      );
      run.turnId ??= started.turn.id;
      if (run.interruptPending) void this.interrupt(run).catch(() => {});
      await finished;
    } finally {
      clearTimeout(run.silence);
      this.runs.delete(threadId);
    }
  }

  protected async listModels(): Promise<ModelOption[]> {
    const rpc = await this.connect();
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

  protected async readLimits(): Promise<ProviderLimits> {
    const rpc = await this.connect();
    return codexLimits(
      await rpc.request<CodexRateLimits>('account/rateLimits/read', undefined),
    );
  }

  close() {
    super.close();
    const server = this.server;
    this.server = undefined;
    void server?.then((rpc) => rpc.close()).catch(() => {});
  }

  /** The shared server, started on first use and again if it dies. */
  private connect(): Promise<CodexRpc> {
    if (this.server) return this.server;
    const server: Promise<CodexRpc> = CodexRpc.start(this.command(), {
      onNotification: (method, params) => {
        const run = this.runs.get(params?.threadId);
        if (run) this.notification(run, method, params);
      },
      onRequest: (id, method, params) =>
        void this.request(id, method, params, server),
      onExit: (error) => {
        if (this.server === server) this.server = undefined;
        for (const run of this.runs.values()) this.fail(run, error);
      },
    });
    // A failed start must not be remembered, or every later turn would fail the same way.
    server.catch(() => {
      if (this.server === server) this.server = undefined;
    });
    this.server = server;
    return server;
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
    run.settle.resolve();
  }

  private fail(run: Run, error: Error) {
    if (run.finished) return;
    run.finished = true;
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
        const message = messageFromItem(params.item as ThreadItem, completed);
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

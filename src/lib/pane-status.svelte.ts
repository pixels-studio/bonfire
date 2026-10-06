import type { AssistantEvent } from '$shared/contracts';

export type PaneStatus = 'idle' | 'working' | 'input' | 'error' | 'done';

/** The statuses worth flagging on a pane's icon while scrolling past it. */
export type PaneBadge = Extract<PaneStatus, 'input' | 'error' | 'done'>;

const BADGES: PaneStatus[] = ['input', 'error', 'done'];

export function paneBadge(status: PaneStatus): PaneBadge | undefined {
  return BADGES.includes(status) ? (status as PaneBadge) : undefined;
}

/** What a project other than the open one has to show for itself; the most urgent wins. */
export type ProjectAttention = PaneBadge;

export const ATTENTION_RANK: Record<ProjectAttention, number> = {
  input: 3,
  error: 2,
  done: 1,
};

export const ATTENTION_LABELS: Record<ProjectAttention, string> = {
  input: 'An agent is waiting for you',
  error: 'An agent failed',
  done: 'An agent finished',
};

export const ATTENTION_DOTS: Record<ProjectAttention, string> = {
  input: 'bg-orange-400',
  error: 'bg-destructive',
  done: 'bg-success',
};

/** Tracks what each pane's assistant is doing, from the main process's event stream. */
export class PaneStatuses {
  #running = $state<Record<string, boolean>>({});
  #failed = $state<Record<string, boolean>>({});
  /** Finished turns the user hasn't looked at yet. */
  #unseen = $state<Record<string, boolean>>({});
  #requests = $state<Record<string, string[]>>({});
  #loaded = new Set<string>();

  /** Waiting on the user wins, then running, then a failed last turn, then an unseen finished one. */
  get(paneId: string): PaneStatus {
    if (this.#requests[paneId]?.length) return 'input';
    if (this.#running[paneId]) return 'working';
    if (this.#failed[paneId]) return 'error';
    if (this.#unseen[paneId]) return 'done';
    return 'idle';
  }

  /** Clears a finished turn's mark once the user has looked at its pane. */
  markSeen(paneId: string) {
    if (this.#unseen[paneId]) this.#unseen[paneId] = false;
  }

  /** Catches up once on a pane whose events were missed, such as after a reload. */
  async load(paneId: string) {
    if (this.#loaded.has(paneId)) return;
    this.#loaded.add(paneId);
    const { running, requests } =
      await window.bonfire.assistant.snapshot(paneId);
    this.#running[paneId] = running;
    this.#requests[paneId] = requests.map(({ id }) => id);
  }

  handle(event: AssistantEvent) {
    const { paneId } = event;
    if (event.type === 'status') {
      this.#running[paneId] = event.status === 'running';
      // A failed turn is followed by `idle`, so the error stays until the next run.
      if (event.status === 'running') {
        this.#failed[paneId] = false;
        this.#unseen[paneId] = false;
      }
      if (event.status === 'failed') this.#failed[paneId] = true;
      // Likewise a finished turn stays marked until it's seen or the next run.
      if (event.status === 'completed') this.#unseen[paneId] = true;
    } else if (event.type === 'request') {
      this.#requests[paneId] = [
        ...(this.#requests[paneId] ?? []),
        event.request.id,
      ];
    } else if (event.type === 'request-resolved') {
      this.#requests[paneId] = (this.#requests[paneId] ?? []).filter(
        (id) => id !== event.requestId,
      );
    }
  }
}

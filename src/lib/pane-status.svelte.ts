import type { AssistantEvent } from '$shared/contracts';

export type PaneStatus = 'idle' | 'working' | 'input' | 'error';

/** Tracks what each pane's assistant is doing, from the main process's event stream. */
export class PaneStatuses {
  #running = $state<Record<string, boolean>>({});
  #failed = $state<Record<string, boolean>>({});
  #requests = $state<Record<string, string[]>>({});
  #loaded = new Set<string>();

  /** Waiting on the user wins, then running, then a failed last turn. */
  get(paneId: string): PaneStatus {
    if (this.#requests[paneId]?.length) return 'input';
    if (this.#running[paneId]) return 'working';
    if (this.#failed[paneId]) return 'error';
    return 'idle';
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
      if (event.status === 'running') this.#failed[paneId] = false;
      if (event.status === 'failed') this.#failed[paneId] = true;
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

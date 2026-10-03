import type { AssistantEvent } from '../../shared/contracts';
import { PROVIDER_LABELS } from '../../shared/domain';
import type { Store } from './persistence';

/** A system notification about a pane. */
export type Notice = { paneId: string; title: string; body: string };

/** What a turn event is worth telling the user about, if anything. */
export function noticeBody(event: AssistantEvent, provider: string) {
  if (event.type === 'status') {
    if (event.status === 'completed') return `${provider} finished`;
    if (event.status === 'failed') return `${provider} failed`;
  } else if (event.type === 'request') {
    return event.request.kind === 'approval'
      ? `${provider} needs approval: ${event.request.title}`
      : `${provider} has a question`;
  }
}

/** Raises notifications when turns finish, fail, or wait on the user, if notifications are on. */
export class TurnNotifier {
  private closed = false;

  constructor(
    private readonly store: Store,
    private readonly show: (notice: Notice) => void,
  ) {}

  handle(event: AssistantEvent) {
    if (this.closed || !this.store.preferences.notifications) return;
    const pane = this.store.state.panes.find(({ id }) => id === event.paneId);
    if (!pane || pane.archived || pane.type === 'terminal') return;
    const body = noticeBody(event, PROVIDER_LABELS[pane.type]);
    if (body) this.show({ paneId: pane.id, title: pane.title, body });
  }

  /** Stops notifying, so turns cut off by quitting don't announce themselves. */
  close() {
    this.closed = true;
  }
}

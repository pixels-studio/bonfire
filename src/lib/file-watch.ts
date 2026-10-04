import type { FileChangeEvent } from '$shared/contracts';
import { Refresher } from './refresher';

/** How often views check a remote folder, whose changes nothing reports. */
const REMOTE_POLL_MS = 5000;

type ChangeKind = FileChangeEvent['kind'];

/** Main watches each project once, for every view of it, and stops with the last. */
const watching = new Map<string, { views: number; live: Promise<boolean> }>();

/**
 * Calls `onchange` when main reports one of `kinds` changing in the project. `live` settles
 * on whether main reports changes at all; remote folders it can't, so those need checking
 * back instead. Returns what stops watching.
 */
export function watchProject(
  projectId: string,
  kinds: ChangeKind[],
  onchange: (kind: ChangeKind) => void,
) {
  const watch = watching.get(projectId) ?? {
    views: 0,
    live: window.bonfire.filesystem.watch(projectId),
  };
  watching.set(projectId, watch);
  watch.views++;
  const unsubscribe = window.bonfire.filesystem.onChange((event) => {
    if (event.projectId === projectId && kinds.includes(event.kind))
      onchange(event.kind);
  });
  let stopped = false;
  return {
    live: watch.live,
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      if (--watch.views) return;
      watching.delete(projectId);
      void window.bonfire.filesystem.unwatch(projectId);
    },
  };
}

/**
 * Keeps a view of the project's files current with `load`: when they change, and every few
 * seconds in a remote folder unless `poll` is off. Returns what stops it.
 */
export function watchFiles(
  projectId: string,
  load: () => unknown,
  {
    poll = true,
    onerror,
  }: { poll?: boolean; onerror?: (cause: unknown) => void } = {},
) {
  const refresher = new Refresher(load);
  const watch = watchProject(projectId, ['files'], () =>
    refresher.invalidate(),
  );
  watch.live.then(
    (live) => {
      if (poll && !live) refresher.setInterval(REMOTE_POLL_MS);
    },
    (cause) => onerror?.(cause),
  );
  return () => {
    refresher.stop();
    watch.stop();
  };
}

const REFRESH_DEBOUNCE_MS = 180;
/**
 * Remote folders aren't watched, and local ones only a few levels deep, so views also check
 * back on this interval while the app is in view.
 */
const POLL_INTERVAL_MS = 5000;

type Watch = {
  /** How many views watch the project; main's watcher is shared and stops with the last. */
  views: number;
  /** The views that check back on a timer, which they share. */
  polling: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
};

const watching = new Map<string, Watch>();

/**
 * Calls `onchange` shortly after files in the project change, and every few
 * seconds besides unless `poll` is off. Returns a function that stops watching.
 */
export function watchFiles(
  projectId: string,
  onchange: () => void,
  {
    poll = true,
    onerror,
  }: { poll?: boolean; onerror?: (cause: unknown) => void } = {},
) {
  let watch = watching.get(projectId);
  if (!watch) {
    watch = { views: 0, polling: new Set() };
    watching.set(projectId, watch);
    window.bonfire.filesystem
      .watch(projectId)
      .catch((cause) => onerror?.(cause));
  }
  watch.views++;

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = window.bonfire.filesystem.onChange((event) => {
    if (event.projectId !== projectId) return;
    clearTimeout(debounce);
    debounce = setTimeout(onchange, REFRESH_DEBOUNCE_MS);
  });
  // Checking back costs a Git status each time, which nobody sees while the app is hidden;
  // coming back into view catches up at once instead. Views of one project check back on
  // one timer, in the same instant, so main runs Git once for all of them rather than once
  // each: several panes polling on their own beats kept Windows spawning git continually.
  const catchUp = () => document.hidden || onchange();
  if (poll) {
    watch.polling.add(onchange);
    const { polling } = watch;
    watch.timer ??= setInterval(() => {
      if (document.hidden) return;
      for (const check of polling) check();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', catchUp);
  }

  return () => {
    unsubscribe();
    clearTimeout(debounce);
    const current = watching.get(projectId);
    if (!current) return;
    if (poll) {
      current.polling.delete(onchange);
      document.removeEventListener('visibilitychange', catchUp);
      if (!current.polling.size) {
        clearInterval(current.timer);
        current.timer = undefined;
      }
    }
    if (--current.views) return;
    watching.delete(projectId);
    void window.bonfire.filesystem.unwatch(projectId);
  };
}

const REFRESH_DEBOUNCE_MS = 180;
/** Remote folders aren't watched, so views also check back on this interval. */
const POLL_INTERVAL_MS = 5000;

/** How many views watch each project; main's watcher is shared and stops with the last. */
const watching = new Map<string, number>();

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
  const views = watching.get(projectId) ?? 0;
  watching.set(projectId, views + 1);
  if (!views)
    window.bonfire.filesystem
      .watch(projectId)
      .catch((cause) => onerror?.(cause));

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = window.bonfire.filesystem.onChange((event) => {
    if (event.projectId !== projectId) return;
    clearTimeout(debounce);
    debounce = setTimeout(onchange, REFRESH_DEBOUNCE_MS);
  });
  const interval = poll ? setInterval(onchange, POLL_INTERVAL_MS) : undefined;

  return () => {
    unsubscribe();
    clearTimeout(debounce);
    clearInterval(interval);
    const left = (watching.get(projectId) ?? 1) - 1;
    if (left) watching.set(projectId, left);
    else {
      watching.delete(projectId);
      void window.bonfire.filesystem.unwatch(projectId);
    }
  };
}

import { untrack } from 'svelte';
import { assistantEvents } from '$lib/main-events';
import { Refresher } from '$lib/refresher';
import type { Pace } from './pace';

/**
 * Keeps usage loaded while the component calling it is on screen: once as it appears, again
 * as agents' turns end, and on `pace`'s interval while they work. `pace` is read as it
 * changes. Nothing loads while the app is hidden; it catches up once on return.
 */
export function refreshOnTurns(load: () => Promise<unknown>, pace: () => Pace) {
  let refresher: Refresher | undefined;
  $effect(() => {
    if (!window.bonfire) return;
    const current = new Refresher(load, untrack(pace));
    refresher = current;
    void current.refresh();
    const stop = assistantEvents.onAll((event) => {
      // Every turn ends `idle`, stopped and failed ones too, and those used the plan as well.
      if (event.type === 'status' && event.status === 'idle')
        current.invalidate(untrack(pace).minGapMs);
    });
    return () => {
      stop();
      current.stop();
      refresher = undefined;
    };
  });
  $effect(() => {
    const { intervalMs } = pace();
    refresher?.setInterval(intervalMs);
  });
}

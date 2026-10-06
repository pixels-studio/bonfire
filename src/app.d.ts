import type { API } from '../shared/contracts';
import type { PaneStatus } from '$lib/pane-status.svelte';
declare global {
  interface Window {
    bonfire: API;
    /** Agent states the demo shows, by pane id; set only by `npm run dev:demo`. */
    bonfireDemoStatuses?: Record<string, PaneStatus>;
  }
}
export {};

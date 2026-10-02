import type { API } from '../shared/contracts';
declare global {
  interface Window {
    bonfire: API;
  }
}
export {};

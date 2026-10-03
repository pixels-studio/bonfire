import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Snippet } from 'svelte';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};

export type WithoutChild<T> = T extends { child?: unknown }
  ? Omit<T, 'child'>
  : T;

export type WithoutChildren<T> = T extends { children?: unknown }
  ? Omit<T, 'children'>
  : T;

export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>> & {
  children?: Snippet;
};

export function isMac() {
  return /mac/i.test(navigator.userAgent);
}

export function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth';
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function formatTokens(tokens: number) {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

/** When a limit resets: "in 42m" or "in 5h 9m" within a day, otherwise the day and time. */
export function formatReset(resetsAt: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 24 * 60)
    return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return new Date(resetsAt).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const COMPACT = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumSignificantDigits: 3,
});

/** A count in three significant digits: 933M, 504K, 3.21M. */
export function formatCompact(count: number) {
  return COMPACT.format(count);
}

export function formatUsd(amount: number) {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

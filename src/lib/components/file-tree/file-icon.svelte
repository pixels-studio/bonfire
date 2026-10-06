<script lang="ts">
  import { cn } from '$lib/utils';

  let { name, class: className }: { name: string; class?: string } = $props();

  type Kind =
    | 'git'
    | 'package'
    | 'vite'
    | 'typescript'
    | 'javascript'
    | 'json'
    | 'markdown'
    | 'svelte'
    | 'css'
    | 'html'
    | 'yaml'
    | 'shell'
    | 'other';

  function kindOf(name: string): Kind {
    if (name === 'package.json') return 'package';
    if (/^\.git(ignore|attributes|modules|keep)?$/.test(name)) return 'git';
    if (/^vite\.config\./.test(name)) return 'vite';
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    if (extension === 'ts' || extension === 'tsx') return 'typescript';
    if (['js', 'mjs', 'cjs', 'jsx'].includes(extension)) return 'javascript';
    if (extension === 'json' || extension === 'jsonc') return 'json';
    if (extension === 'md' || extension === 'mdx') return 'markdown';
    if (extension === 'svelte') return 'svelte';
    if (['css', 'scss', 'sass', 'less'].includes(extension)) return 'css';
    if (['html', 'htm'].includes(extension)) return 'html';
    if (['yaml', 'yml', 'toml'].includes(extension)) return 'yaml';
    if (['sh', 'bash', 'zsh'].includes(extension)) return 'shell';
    return 'other';
  }

  const kind = $derived(kindOf(name));
</script>

{#if kind === 'other'}
  <svg
    class={cn('size-4 text-muted-foreground', className)}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 2H6.75C5.23122 2 4 3.23122 4 4.75V19.25C4 20.7688 5.23122 22 6.75 22H17.25C18.7688 22 20 20.7688 20 19.25V10H14.75C13.2312 10 12 8.76878 12 7.25V2Z"
      fill="currentColor"
    />
    <path
      d="M19.5566 8.49993C19.5343 8.47493 19.5112 8.45051 19.4874 8.4267L13.5732 2.51249C13.5494 2.48868 13.525 2.46564 13.5 2.44336V7.24993C13.5 7.94028 14.0596 8.49993 14.75 8.49993H19.5566Z"
      fill="currentColor"
    />
  </svg>
{:else}
  <svg
    class={cn('size-4', className)}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    {#if kind === 'typescript'}
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#2f5df4" />
      <text
        x="12"
        y="18.5"
        text-anchor="middle"
        font-size="12.5"
        font-weight="800"
        font-family="Inter, sans-serif"
        fill="#fff">TS</text
      >
    {:else if kind === 'javascript'}
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#f7c600" />
      <text
        x="12"
        y="19"
        text-anchor="middle"
        font-size="12.5"
        font-weight="800"
        font-family="Inter, sans-serif"
        fill="#1a1a1a">JS</text
      >
    {:else if kind === 'json'}
      <path
        d="M8.5 4C6.8 4 6.5 5 6.5 6.5V9c0 1.2-.6 2-2 3 1.4 1 2 1.8 2 3v2.500C6.5 19 6.8 20 8.5 20M15.5 4c1.7 0 2 1 2 2.500V9c0 1.2.6 2 2 3-1.4 1-2 1.8-2 3v2.500c0 1.5-.3 2.5-2 2.5"
        stroke="#e8a317"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {:else if kind === 'markdown'}
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M4.75 4C3.23122 4 2 5.23122 2 6.75V17.25C2 18.7688 3.23122 20 4.75 20H19.25C20.7688 20 22 18.7688 22 17.25V6.75C22 5.23122 20.7688 4 19.25 4H4.75ZM7.28033 9.21967C7.06583 9.00517 6.74324 8.941 6.46299 9.05709C6.18273 9.17318 6 9.44665 6 9.75V14.25C6 14.6642 6.33579 15 6.75 15C7.16421 15 7.5 14.6642 7.5 14.25V11.5607L8.46967 12.5303C8.76256 12.8232 9.23744 12.8232 9.53033 12.5303L10.5 11.5607V14.25C10.5 14.6642 10.8358 15 11.25 15C11.6642 15 12 14.6642 12 14.25V9.75C12 9.44665 11.8173 9.17318 11.537 9.05709C11.2568 8.941 10.9342 9.00517 10.7197 9.21967L9 10.9393L7.28033 9.21967ZM16.5 9.75C16.5 9.33579 16.1642 9 15.75 9C15.3358 9 15 9.33579 15 9.75V12.4393L14.5303 11.9697C14.2374 11.6768 13.7626 11.6768 13.4697 11.9697C13.1768 12.2626 13.1768 12.7374 13.4697 13.0303L15.2197 14.7803C15.5126 15.0732 15.9874 15.0732 16.2803 14.7803L18.0303 13.0303C18.3232 12.7374 18.3232 12.2626 18.0303 11.9697C17.7374 11.6768 17.2626 11.6768 16.9697 11.9697L16.5 12.4393V9.75Z"
        fill="#8b8b8b"
      />
    {:else if kind === 'git'}
      <path
        d="M12 1.5 22.5 12 12 22.5 1.5 12Z"
        fill="#e8590c"
        stroke="#e8590c"
        stroke-width="1"
        stroke-linejoin="round"
      />
      <circle cx="10" cy="15" r="1.5" fill="#161313" />
      <circle cx="10" cy="8.5" r="1.5" fill="#161313" />
      <circle cx="14.5" cy="12" r="1.5" fill="#161313" />
      <path
        d="M10 10v3.500M10 10c0 2 4.5 0 4.5 2"
        stroke="#161313"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    {:else if kind === 'vite'}
      <path
        d="M2.5 4.5 12 21.5 21.5 4.500c.3-.6-.2-1.2-.8-1.100L12.4 4.900a1 1 0 0 1-.4 0L3.3 3.400c-.6-.1-1.1.5-.8 1.100Z"
        fill="#a24df2"
      />
      <path
        d="M16.5 3.5 10 4.800l-.3 5.2 2.1-.5-.6 4.5 2.7-.7-.9 4.3 5.2-9.6-3 .6Z"
        fill="#ffd62e"
      />
    {:else if kind === 'package'}
      <path
        d="M12 1.8 20.8 6.900v10.200L12 22.2 3.2 17.100V6.900Z"
        stroke="#3fa54a"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <text
        x="12"
        y="16"
        text-anchor="middle"
        font-size="8.5"
        font-weight="800"
        font-family="Inter, sans-serif"
        fill="#3fa54a">JS</text
      >
    {:else if kind === 'svelte'}
      <path
        d="M10.354 21.125a4.44 4.44 0 0 1-4.765-1.767 4.109 4.109 0 0 1-.703-3.107 3.898 3.898 0 0 1 .134-.522l.105-.321.287.21a7.21 7.21 0 0 0 2.186 1.092l.208.063-.02.208a1.253 1.253 0 0 0 .226.83 1.337 1.337 0 0 0 1.435.533 1.231 1.231 0 0 0 .343-.15l5.59-3.562a1.164 1.164 0 0 0 .524-.778 1.242 1.242 0 0 0-.211-.937 1.338 1.338 0 0 0-1.435-.533 1.23 1.23 0 0 0-.343.15l-2.133 1.36a4.078 4.078 0 0 1-1.135.499 4.44 4.44 0 0 1-4.765-1.766 4.108 4.108 0 0 1-.702-3.108 3.855 3.855 0 0 1 1.742-2.582l5.589-3.563a4.072 4.072 0 0 1 1.135-.5 4.44 4.44 0 0 1 4.765 1.767 4.109 4.109 0 0 1 .703 3.107 3.943 3.943 0 0 1-.134.522l-.105.321-.286-.21a7.204 7.204 0 0 0-2.187-1.093l-.208-.063.02-.207a1.255 1.255 0 0 0-.226-.83 1.337 1.337 0 0 0-1.435-.532 1.231 1.231 0 0 0-.343.15L8.62 9.368a1.162 1.162 0 0 0-.524.778 1.24 1.24 0 0 0 .211.937 1.338 1.338 0 0 0 1.435.533 1.235 1.235 0 0 0 .344-.151l2.132-1.36a4.067 4.067 0 0 1 1.135-.498 4.44 4.44 0 0 1 4.765 1.766 4.108 4.108 0 0 1 .702 3.108 3.857 3.857 0 0 1-1.742 2.583l-5.589 3.562a4.072 4.072 0 0 1-1.135.5z"
        fill="#ff3e00"
      />
    {:else if kind === 'css'}
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#3b82f6" />
      <text
        x="12"
        y="16.5"
        text-anchor="middle"
        font-size="13"
        font-weight="800"
        font-family="Inter, sans-serif"
        fill="#fff">#</text
      >
    {:else if kind === 'html'}
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#e8590c" />
      <text
        x="12"
        y="16.5"
        text-anchor="middle"
        font-size="9.5"
        font-weight="800"
        font-family="Inter, sans-serif"
        fill="#fff">&lt;&gt;</text
      >
    {:else if kind === 'yaml'}
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#7c8798" />
      <text
        x="12"
        y="16.5"
        text-anchor="middle"
        font-size="12"
        font-weight="800"
        font-family="Inter, sans-serif"
        fill="#fff">Y</text
      >
    {:else if kind === 'shell'}
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#3a3a3a" />
      <text
        x="12"
        y="16.5"
        text-anchor="middle"
        font-size="13"
        font-weight="800"
        font-family="Inter, sans-serif"
        fill="#7ee787">$</text
      >
    {/if}
  </svg>
{/if}

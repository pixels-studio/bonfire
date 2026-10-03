<script lang="ts">
  import File from '@lucide/svelte/icons/file';
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
  <File class={cn('size-4 text-muted-foreground', className)} />
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
      <rect x="1.5" y="5" width="21" height="14" rx="3" fill="#8b8b8b" />
      <path
        d="M5 15.500v-7l2.5 3 2.5-3v7M16 8.500v6m-2.2-2.2 2.2 2.5 2.2-2.5"
        stroke="#161313"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
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

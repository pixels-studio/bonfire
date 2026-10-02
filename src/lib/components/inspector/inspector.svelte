<script lang="ts">
  import { onMount } from 'svelte';
  import type { Session, GitStatus, Entry } from '$shared/contracts';
  let {
    session,
    initialMode = 'diff',
    embedded = false,
  }: {
    session: Session;
    initialMode?: 'diff' | 'files';
    embedded?: boolean;
  } = $props();
  let mode = $state<'diff' | 'files'>('diff');
  let status = $state<GitStatus>({ isGit: false, branch: '', changes: [] });
  let entries = $state<Entry[]>([]);
  let path = $state('');
  let content = $state('');
  let selected = $state('');
  let error = $state('');
  let generation = 0;
  async function refresh() {
    const token = ++generation;
    try {
      const [s, e] = await Promise.all([
        window.bonfire.git.status(session.id),
        window.bonfire.filesystem.list(session.id, path),
      ]);
      if (token !== generation) return;
      status = s;
      entries = e;
      if (selected) await preview(selected);
      error = '';
    } catch (e) {
      error = String(e);
    }
  }
  async function preview(file: string) {
    selected = file;
    try {
      content =
        mode === 'diff'
          ? await window.bonfire.git.diff(session.id, file)
          : await window.bonfire.filesystem.readFile(session.id, file);
    } catch (e) {
      content = String(e);
    }
  }
  async function folder(next: string) {
    path = next;
    selected = '';
    content = '';
    await refresh();
  }
  onMount(() => {
    mode = initialMode;
    void refresh();
    void window.bonfire.filesystem
      .watch(session.id)
      .catch((e) => (error = String(e)));
    let timer: ReturnType<typeof setTimeout>;
    const off = window.bonfire.filesystem.onChange((e) => {
      if (e.sessionId === session.id) {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 180);
      }
    });
    const poll = setInterval(() => void refresh(), 5000);
    return () => {
      generation++;
      off();
      clearTimeout(timer);
      clearInterval(poll);
      void window.bonfire.filesystem.unwatch(session.id);
    };
  });
</script>

<section class="inspector panel" class:embedded>
  {#if !embedded}<header>
    <img src="/icons/diff.svg" alt="" /><button
      class="plain title"
      onclick={() => {
        mode = mode === 'diff' ? 'files' : 'diff';
        selected = '';
        content = '';
        void refresh();
      }}
      >{mode === 'diff' ? 'Code Diff' : 'Files'}
      <span class="muted">⌄</span></button
    ><span class="badge" title={status.branch}>{status.branch || 'Folder'}</span
    ><button
      class="plain ml-auto"
      aria-label="Refresh files and Git"
      onclick={refresh}>↻</button
    >
  </header>{/if}
  <div class="inspection">
    {#if error}<p class="error">{error}</p>{/if}
    {#if mode === 'diff'}
      {#if !status.changes.length}<div class="empty">
          <p>
            {status.isGit
              ? 'Your working tree is clean.'
              : 'This folder is not a Git repository.'}
          </p>
          <button
            onclick={() => {
              mode = 'files';
              void refresh();
            }}>Browse files</button
          >
        </div>{/if}
      {#each status.changes as change}<button
          class="file-row"
          onclick={() => preview(change.path)}
          ><span class="file-mark">±</span><span class="truncate"
            >{change.path}</span
          ><span class="change-state">{change.index}{change.worktree}</span
          ></button
        >{#if selected === change.path}<div class="code diff">
            {#each content.split('\n') as line}<div
                class:added={line.startsWith('+')}
                class:removed={line.startsWith('-')}
                class:hunk={line.startsWith('@@')}
              >
                {line || ' '}
              </div>{/each}
          </div>{/if}{/each}
    {:else}
      <div class="flex items-center gap-2 mb-3">
        <button
          disabled={!path}
          onclick={() => folder(path.split('/').slice(0, -1).join('/'))}
          >↑</button
        ><span class="muted truncate">/{path}</span>
      </div>
      {#each entries as entry}<button
          class="file-row"
          onclick={() =>
            entry.directory
              ? folder([path, entry.name].filter(Boolean).join('/'))
              : preview([path, entry.name].filter(Boolean).join('/'))}
          ><span class="muted">{entry.directory ? '▸' : '·'}</span
          >{entry.name}</button
        >{/each}
      {#if selected}<p class="muted mt-5">{selected}</p>
        <pre class="code">{content}</pre>{/if}
    {/if}
  </div>
</section>

<style>
  .inspector {
    min-width: 300px;
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .inspection {
    padding: 10px 16px;
    overflow: auto;
    flex: 1;
  }
  .embedded {
    height: 100%;
    min-width: 0;
    border-radius: 0;
    background: transparent;
  }
  .file-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 0;
    background: none;
    text-align: left;
    padding: 14px 0;
    font-size: 14px;
  }
  .file-mark {
    color: #ff6317;
    font-size: 20px;
  }
  .change-state {
    margin-left: auto;
    color: #76b93c;
    font-family: monospace;
  }
  .code {
    font:
      12px/1.7 Menlo,
      monospace;
    border: 1px solid #2e3825;
    border-radius: 8px;
    padding: 12px;
    overflow: auto;
    white-space: pre;
    margin: 0 0 12px;
  }
  .added {
    color: #99cd75;
    background: #24311c;
  }
  .removed {
    color: #e9948b;
    background: #392322;
  }
  .hunk {
    color: #9ea9db;
  }
  .empty {
    padding: 30px 0;
    color: #999;
  }
  .empty button {
    margin-top: 16px;
  }
</style>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import TextView from '../conversation/text-view.svelte';
  import AttachmentView from '../conversation/attachment-view.svelte';
  import ThinkingView from '../conversation/thinking-view.svelte';
  import ToolView from '../conversation/tool-view.svelte';
  import Inspector from '../inspector/inspector.svelte';
  import type TerminalPane from '../terminal-pane/terminal-pane.svelte';
  import type {
    AssistantEvent,
    Attachment,
    ConversationMessage,
    Pane,
    Session,
    Usage,
  } from '$shared/contracts';

  type PaneSize = 'full' | 'half' | 'third';
  type View = 'chat' | 'terminal' | 'diff' | 'files';

  let {
    pane,
    session,
    onarchive,
    onresize,
    onrefresh,
  }: {
    pane: Pane;
    session: Session;
    onarchive: () => void;
    onresize: (size: PaneSize) => void;
    onrefresh: () => void;
  } = $props();

  const provider = $derived(pane.type === 'claude' ? 'claude' : 'codex');
  const providerLabel = $derived(pane.type === 'claude' ? 'Claude' : 'Codex');

  let messages = $state<ConversationMessage[]>([
    ...untrack(() => pane.messages),
  ]);
  let usage = $state<Usage | undefined>(untrack(() => pane.usage));
  let running = $state(false);
  let prompt = $state('');
  let error = $state('');
  let view = $state<View>('chat');
  let attachments = $state<Attachment[]>([]);
  let displayTitle = $state(
    untrack(() =>
      pane.title === 'Codex' ||
      pane.title === 'Claude' ||
      pane.title === 'New Conversation'
        ? 'New Conversation'
        : pane.title,
    ),
  );
  let feed = $state<HTMLDivElement>();
  let TerminalPaneComponent = $state<typeof TerminalPane>();
  let branches = $state<string[]>([]);
  let branchesLoading = $state(false);
  let branchError = $state('');
  const models = untrack(() =>
    pane.type === 'claude'
      ? [
          { value: 'opus', label: 'Opus 5.5', contextWindow: 200000 },
          { value: 'sonnet', label: 'Sonnet 5.5', contextWindow: 200000 },
          {
            value: 'sonnet-1m',
            label: 'Sonnet 5.5 (1M)',
            contextWindow: 1000000,
          },
          { value: 'haiku', label: 'Haiku 4.5', contextWindow: 200000 },
        ]
      : [
          { value: 'gpt-5.6-terra', label: 'Terra', contextWindow: 300000 },
          { value: 'gpt-6-astra', label: 'Astra', contextWindow: 400000 },
        ],
  );
  let model = $state(
    untrack(() =>
      models.some((item) => item.value === pane.model)
        ? pane.model
        : models[0].value,
    ),
  );
  const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
  const EFFORT_LABELS: Record<(typeof EFFORT_LEVELS)[number], string> = {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Max',
  };
  let effortValue = $state(
    untrack(() => Math.max(0, EFFORT_LEVELS.indexOf(pane.reasoningEffort))),
  );
  const effort = $derived(EFFORT_LEVELS[effortValue]);
  const contextWindow = $derived(
    models.find((item) => item.value === model)?.contextWindow ??
      models[0].contextWindow,
  );
  const usedTokens = $derived(
    usage
      ? usage.inputTokens + usage.outputTokens + usage.reasoningOutputTokens
      : 0,
  );
  const tokenPct = $derived(
    contextWindow ? Math.min(usedTokens / contextWindow, 1) : 0,
  );
  const tokenRingColor = $derived(
    tokenPct >= 0.75
      ? 'var(--destructive)'
      : tokenPct >= 0.5
        ? 'var(--accent)'
        : 'var(--foreground-subtle)',
  );
  const TOKEN_RING_RADIUS = 7;
  const TOKEN_RING_CIRCUMFERENCE = 2 * Math.PI * TOKEN_RING_RADIUS;

  function updateMessage(message: ConversationMessage) {
    const index = messages.findIndex((item) => item.id === message.id);
    if (index === -1) messages = [...messages, message];
    else messages[index] = message;
    messages = [...messages];
    void tick().then(() => feed?.scrollTo({ top: feed.scrollHeight }));
  }

  async function submit() {
    const text = prompt.trim();
    if (!text || running) return;
    prompt = '';
    error = '';
    running = true;
    if (displayTitle === 'New Conversation') displayTitle = titleFrom(text);
    const attachmentIds = attachments.map(({ id }) => id);
    attachments = [];
    try {
      await window.bonfire.assistant.send({
        paneId: pane.id,
        text,
        attachmentIds,
        model,
        reasoningEffort: effort,
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      running = false;
    }
  }

  async function pickAttachment() {
    if (attachments.length >= 8) return;
    try {
      const attachment = await window.bonfire.assistant.pickAttachment(pane.id);
      if (attachment) attachments = [...attachments, attachment];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function titleFrom(text: string) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 42 ? `${compact.slice(0, 41).trimEnd()}…` : compact;
  }

  async function toggleView(next: View) {
    view = view === next ? 'chat' : next;
    if (view === 'terminal' && !TerminalPaneComponent)
      TerminalPaneComponent = (
        await import('../terminal-pane/terminal-pane.svelte')
      ).default;
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  function contextLabel(tokens: number) {
    if (!tokens) return '0';
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
  }

  async function loadBranches() {
    branchesLoading = true;
    branchError = '';
    try {
      branches = await window.bonfire.git.branches(session.projectId);
    } catch (cause) {
      branchError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      branchesLoading = false;
    }
  }

  async function switchBranch(branch: string) {
    if (branch === session.branch) return;
    branchError = '';
    try {
      await window.bonfire.git.checkout(session.id, branch);
      onrefresh();
    } catch (cause) {
      branchError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  onMount(() =>
    window.bonfire.assistant.onEvent((event: AssistantEvent) => {
      if (event.paneId !== pane.id) return;
      if (event.type === 'message') updateMessage(event.message);
      if (event.type === 'usage') usage = event.usage;
      if (event.type === 'status') {
        running = event.status === 'running';
        if (event.error) error = event.error;
      }
    }),
  );
</script>

{#snippet branchPicker(triggerClass: string)}
  <DropdownMenu.Root onOpenChange={(open) => open && loadBranches()}>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}<button {...props} class={triggerClass}
          ><Icon name="git" /> {session.branch || 'Folder'}</button
        >{/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start">
      <DropdownMenu.Label>Switch branch</DropdownMenu.Label>
      {#if branchesLoading}
        <DropdownMenu.Item disabled>Loading branches…</DropdownMenu.Item>
      {:else if branchError}
        <DropdownMenu.Item disabled>{branchError}</DropdownMenu.Item>
      {:else if !branches.length}
        <DropdownMenu.Item disabled>No branches found</DropdownMenu.Item>
      {:else}
        {#each branches as branch}
          <DropdownMenu.Item onclick={() => switchBranch(branch)}
            >{branch}{#if branch === session.branch}<Check
                class="check"
              />{/if}</DropdownMenu.Item
          >
        {/each}
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<Card.Root class="assistant-card">
  <header class="pane-header">
    <div class="pane-title">
      <Icon name="bot" aria-hidden="true" />
      <span class="text-sm" title={displayTitle}>{displayTitle}</span>
    </div>
    <div class="pane-actions">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open file preview"
        class={view === 'files' ? 'active' : ''}
        onclick={() => (view = view === 'files' ? 'chat' : 'files')}
        ><Icon name="folder" /></Button
      >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open terminal"
        class={view === 'terminal' ? 'active' : ''}
        onclick={() => toggleView('terminal')}><Icon name="terminal" /></Button
      >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open code diff"
        class={view === 'diff' ? 'active' : ''}
        onclick={() => (view = view === 'diff' ? 'chat' : 'diff')}
        ><Icon name="code" /></Button
      >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}<Button
              {...props}
              variant="ghost"
              size="icon"
              aria-label="Conversation options"><Icon name="dots" /></Button
            >{/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Label>Pane size</DropdownMenu.Label>
          <DropdownMenu.Item onclick={() => onresize('full')}
            ><Icon name="full" /> Full</DropdownMenu.Item
          >
          <DropdownMenu.Item onclick={() => onresize('half')}
            ><Icon name="half" /> Half</DropdownMenu.Item
          >
          <DropdownMenu.Item onclick={() => onresize('third')}
            ><Icon name="one-third" /> Third</DropdownMenu.Item
          >
          <DropdownMenu.Separator />
          <DropdownMenu.Item variant="destructive" onclick={onarchive}
            ><Icon name="archive" /> Archive</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </header>

  <div class="pane-content">
    {#if view === 'chat'}
      <div class="conversation" bind:this={feed} aria-live="polite">
        {#if messages.length === 0}
          <div class="empty-conversation">
            <Icon name={provider} />
            <p class="text-sm">
              Ask {providerLabel} to explore, explain, or change this project.
            </p>
          </div>
        {/if}
        {#each messages as message (message.id)}
          {#if message.kind === 'text' || message.kind === 'error'}
            <TextView {message} />
          {:else if message.kind === 'thinking'}
            <ThinkingView {message} />
          {:else if message.kind === 'tool'}
            <ToolView {message} />
          {:else if message.kind === 'attachment'}
            <AttachmentView
              name={message.text}
              size={message.size}
              previewUrl={message.previewUrl}
            />
          {/if}
        {/each}
        {#if error}<p class="pane-error" role="alert">{error}</p>{/if}
      </div>
    {:else if view === 'terminal'}
      <div class="terminal-view">
        {#if TerminalPaneComponent}
          <TerminalPaneComponent
            pane={{ ...pane, type: 'terminal', title: 'Terminal' }}
            active={true}
            onstatus={() => {}}
          />
        {/if}
      </div>
    {:else}
      {#key view}<Inspector {session} initialMode={view} embedded />{/key}
    {/if}
  </div>

  {#if view === 'chat'}
    <div class="composer-wrap">
      <div class="composer-branch-row">
        {@render branchPicker('composer-branch-trigger')}
      </div>
      <form
        class="composer"
        onsubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {#if attachments.length}
          <div class="pending-attachments" aria-label="Selected attachments">
            {#each attachments as attachment (attachment.id)}
              <div class="attachment-chip">
                <AttachmentView
                  name={attachment.name}
                  size={attachment.size}
                  previewUrl={attachment.previewUrl}
                />
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onclick={() =>
                    (attachments = attachments.filter(
                      ({ id }) => id !== attachment.id,
                    ))}><X /></button
                >
              </div>
            {/each}
          </div>
        {/if}
        <textarea
          class="text-sm"
          aria-label={`Message ${providerLabel}`}
          placeholder="Ask for changes"
          bind:value={prompt}
          onkeydown={keydown}
          disabled={running}></textarea>
        <div class="composer-footer">
          <div class="composer-meta">
            <Select.Root type="single" items={models} bind:value={model}>
              <Select.Trigger aria-label="Select model" class="model-trigger"
                ><Select.Value placeholder="Default" /></Select.Trigger
              >
              <Select.Content>
                {#each models as item}<Select.Item
                    value={item.value}
                    label={item.label}>{item.label}</Select.Item
                  >{/each}
              </Select.Content>
            </Select.Root>
            <Popover.Root>
              <Popover.Trigger>
                {#snippet child({ props })}<button
                    {...props}
                    class="effort text-sm"
                    >{EFFORT_LABELS[effort]}<ChevronDown /></button
                  >{/snippet}
              </Popover.Trigger>
              <Popover.Content
                class="effort-popover p-[24px]"
                align="start"
                side="top"
              >
                <p class="effort-popover-label text-sm">
                  Thinking effort · {EFFORT_LABELS[effort]}
                </p>
                <div class="effort-slider-wrap">
                  <Slider
                    type="single"
                    bind:value={effortValue}
                    min={0}
                    max={EFFORT_LEVELS.length - 1}
                    step={1}
                  />
                  <div class="effort-marks" aria-hidden="true">
                    {#each EFFORT_LEVELS as _level, i}
                      <span
                        class="effort-mark"
                        style:left={`${(i / (EFFORT_LEVELS.length - 1)) * 100}%`}
                      ></span>
                    {/each}
                  </div>
                </div>
              </Popover.Content>
            </Popover.Root>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}<button
                    {...props}
                    class="context-usage"
                    aria-label={`${contextLabel(usedTokens)} of ${contextLabel(contextWindow)} tokens used`}
                  >
                    <svg class="token-ring" viewBox="0 0 18 18" aria-hidden="true">
                      <circle
                        cx="9"
                        cy="9"
                        r={TOKEN_RING_RADIUS}
                        fill="none"
                        stroke="var(--control-active)"
                        stroke-width="2.5"
                      />
                      <circle
                        cx="9"
                        cy="9"
                        r={TOKEN_RING_RADIUS}
                        fill="none"
                        stroke={tokenRingColor}
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-dasharray={TOKEN_RING_CIRCUMFERENCE}
                        stroke-dashoffset={TOKEN_RING_CIRCUMFERENCE *
                          (1 - tokenPct)}
                        transform="rotate(-90 9 9)"
                      />
                    </svg>
                  </button
                  >{/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>
                {usage
                  ? `${contextLabel(usedTokens)} / ${contextLabel(contextWindow)} tokens · ${usage.inputTokens.toLocaleString()} input · ${usage.outputTokens.toLocaleString()} output · ${usage.reasoningOutputTokens.toLocaleString()} reasoning`
                  : 'Context usage appears after the first response'}
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          <div class="composer-actions">
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}<Button
                    {...props}
                    variant="secondary"
                    size="icon"
                    aria-label="Add image"
                    disabled={running || attachments.length >= 8}
                    onclick={pickAttachment}><Icon name="attachment" /></Button
                  >{/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Add image</Tooltip.Content>
            </Tooltip.Root>
            {#if running}
              <Button
                variant="secondary"
                size="icon"
                aria-label="Stop response"
                onclick={() => window.bonfire.assistant.cancel(pane.id)}
                ><Square /></Button
              >
            {:else}
              <Button
                class="send"
                size="icon"
                aria-label="Send message"
                type="submit"
                disabled={!prompt.trim()}><ArrowUp /></Button
              >
            {/if}
          </div>
        </div>
      </form>
    </div>
  {/if}
</Card.Root>

<style>
  :global(.assistant-card) {
    height: 100%;
    min-width: 0;
    background: var(--panel);
  }
  .pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    gap: 12px;
    padding: 12px 16px;
  }
  .pane-title,
  .pane-actions,
  .composer-footer,
  .composer-meta,
  .composer-actions,
  .composer-branch-row {
    display: flex;
    align-items: center;
  }
  .pane-title {
    min-width: 0;
    gap: 8px;
  }
  .pane-title > :global(svg) {
    flex: none;
    width: 20px;
    height: 20px;
  }
  .pane-title > span {
    overflow: hidden;
    color: var(--foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.check) {
    margin-left: auto;
  }
  .pane-actions {
    gap: 8px;
  }
  .pane-actions :global(button) {
    color: var(--foreground-subtle);
  }
  .pane-actions :global(button.active) {
    background: var(--control-active);
    color: var(--foreground);
  }
  .pane-content {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .conversation {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 24px;
    overflow-y: auto;
    padding: 26px 16px 28px;
    scroll-behavior: smooth;
  }
  .empty-conversation {
    display: grid;
    flex: 1;
    gap: 4px;
    place-content: center;
    justify-items: center;
    color: var(--foreground-subtle);
    text-align: center;
  }
  .empty-conversation :global(svg) {
    width: 24px;
    height: 24px;
  }
  .empty-conversation p {
    max-width: 260px;
    text-wrap: pretty;
  }
  .pane-error {
    color: var(--destructive);
  }
  .terminal-view {
    position: absolute;
    inset: 0;
  }
  .composer-wrap {
    flex: none;
    padding: 0 16px 16px;
  }
  .composer-branch-row {
    gap: 24px;
    padding: 0 2px 12px;
    color: var(--foreground-subtle);
    font-size: 14px;
  }
  .composer-branch-trigger {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .composer-branch-row :global(svg) {
    width: 16px;
    height: 16px;
  }
  .composer {
    padding: 12px 16px;
    border-radius: 8px;
    background: var(--composer);
  }
  .pending-attachments {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 8px;
  }
  .attachment-chip {
    position: relative;
    flex: none;
  }
  .attachment-chip > button {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    padding: 3px;
    border: 0;
    border-radius: 50%;
    background: var(--control-active);
    color: var(--foreground);
  }
  .attachment-chip > button :global(svg) {
    width: 12px;
    height: 12px;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 60px;
    resize: none;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--foreground);
  }
  textarea::placeholder {
    color: var(--foreground-subtle);
  }
  .composer-footer {
    justify-content: space-between;
    gap: 12px;
  }
  .composer-meta {
    min-width: 0;
    gap: 24px;
  }
  :global(.model-trigger) {
    border: 0;
    padding: 6px 0;
    background: transparent;
    color: var(--foreground);
  }
  .effort {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--foreground);
  }
  .effort :global(svg) {
    width: 14px;
    height: 14px;
  }
  .context-usage {
    display: grid;
    flex: none;
    place-items: center;
    padding: 4px;
    border: 0;
    background: transparent;
  }
  .token-ring {
    width: 16px;
    height: 16px;
  }
  .token-ring circle {
    transition: stroke-dashoffset 200ms ease-out;
  }
  :global(.effort-popover) {
    width: 220px;
    gap: 10px;
  }
  .effort-popover-label {
    margin: 0;
    color: var(--foreground);
  }
  .effort-slider-wrap {
    position: relative;
    padding: 4px 0;
  }
  .effort-marks {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .effort-mark {
    position: absolute;
    top: 50%;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--foreground-subtle);
    transform: translate(-50%, -50%);
  }
  .composer-actions {
    gap: 10px;
  }
  :global(.send) {
    background: var(--accent);
    color: white;
  }
  @media (prefers-reduced-motion: reduce) {
    .conversation {
      scroll-behavior: auto;
    }
  }
</style>

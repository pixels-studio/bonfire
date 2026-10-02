<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import AttachmentView from '../conversation/attachment-view.svelte';
  import TextView from '../conversation/text-view.svelte';
  import ThinkingView from '../conversation/thinking-view.svelte';
  import ToolView from '../conversation/tool-view.svelte';
  import Inspector from '../inspector/inspector.svelte';
  import AssistantHeader from './assistant-header.svelte';
  import BranchPicker from './branch-picker.svelte';
  import Composer from './composer.svelte';
  import ContextUsage from './context-usage.svelte';
  import EffortPicker from './effort-picker.svelte';
  import ModelSelect from './model-select.svelte';
  import { MODELS, findModel, modelsFor } from '$lib/models';
  import {
    DEFAULT_TITLE,
    PROVIDER_LABELS,
    errorMessage,
    isDefaultTitle,
    titleFrom,
  } from '$shared/domain';
  import type { PaneSize, PaneView } from '$lib/panes';
  import { toast } from '$lib/stores/toast.svelte';
  import type {
    AssistantProvider,
    ConversationMessage,
    Pane,
    ReasoningEffort,
    Session,
    Usage,
  } from '$shared/contracts';

  let {
    pane,
    session,
    onarchive,
    onresize,
    onrefresh,
    onswitchprovider,
    onretype,
  }: {
    pane: Pane;
    session: Session;
    onarchive: () => void;
    onresize: (size: PaneSize) => void;
    onrefresh: () => void;
    onswitchprovider: (provider: AssistantProvider, model: string) => void;
    onretype: (provider: AssistantProvider, model: string) => void;
  } = $props();

  const provider = $derived<AssistantProvider>(
    pane.type === 'claude' ? 'claude' : 'codex',
  );
  const providerLabel = $derived(PROVIDER_LABELS[provider]);

  let messages = $state<ConversationMessage[]>(
    untrack(() => [...pane.messages]),
  );
  let usage = $state<Usage | undefined>(untrack(() => pane.usage));
  let running = $state(false);
  let error = $state('');
  let view = $state<PaneView>('chat');
  let feed = $state<HTMLDivElement>();
  let title = $state(
    untrack(() => (isDefaultTitle(pane.title) ? DEFAULT_TITLE : pane.title)),
  );
  let effort = $state<ReasoningEffort>(untrack(() => pane.reasoningEffort));
  let model = $state(
    untrack(() => {
      const available = modelsFor(provider);
      return available.some((item) => item.value === pane.model)
        ? pane.model
        : available[0].value;
    }),
  );
  const contextWindow = $derived((findModel(model) ?? MODELS[0]).contextWindow);

  function upsertMessage(message: ConversationMessage) {
    const index = messages.findIndex((item) => item.id === message.id);
    if (index === -1) messages.push(message);
    else messages[index] = message;
    void tick().then(() => feed?.scrollTo({ top: feed.scrollHeight }));
  }

  async function send(text: string, attachmentIds: string[]) {
    error = '';
    running = true;
    if (title === DEFAULT_TITLE) title = titleFrom(text);
    try {
      await window.bonfire.assistant.send({
        paneId: pane.id,
        text,
        attachmentIds,
        model,
        reasoningEffort: effort,
      });
    } catch (cause) {
      error = errorMessage(cause);
      running = false;
    }
  }

  function changeModel(next: string) {
    const target = findModel(next);
    if (!target || next === model) return;
    if (target.provider !== provider) {
      if (messages.length) onswitchprovider(target.provider, next);
      else onretype(target.provider, next);
      return;
    }
    model = next;
    if (messages.length)
      toast(
        'FYI: When you switch models mid-chat, your next response will be slower and use more tokens.',
      );
  }

  onMount(() =>
    window.bonfire.assistant.onEvent((event) => {
      if (event.paneId !== pane.id) return;
      if (event.type === 'message') upsertMessage(event.message);
      if (event.type === 'usage') usage = event.usage;
      if (event.type === 'status') {
        running = event.status === 'running';
        if (event.error) error = event.error;
      }
    }),
  );
</script>

<Card.Root class="h-full min-w-0">
  <AssistantHeader {title} bind:view {onresize} {onarchive} />

  <div class="relative min-h-0 flex-1">
    {#if view === 'chat'}
      <div
        bind:this={feed}
        class="absolute inset-0 flex flex-col overflow-y-auto px-4 pt-6 pb-7 motion-safe:scroll-smooth"
        aria-live="polite"
      >
        <div
          class="@container mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6"
        >
          {#each messages as message (message.id)}
            {#if message.kind === 'text' || message.kind === 'error'}
              <TextView {message} />
            {:else if message.kind === 'thinking'}
              <ThinkingView {message} />
            {:else if message.kind === 'tool'}
              <ToolView {message} />
            {:else if message.kind === 'attachment'}
              <AttachmentView
                class="max-w-4/5 self-end @lg:max-w-100"
                name={message.text}
                size={message.size}
                previewUrl={message.previewUrl}
              />
            {/if}
          {:else}
            <div
              class="grid flex-1 place-content-center justify-items-center gap-1 text-center text-muted-foreground"
            >
              <Icon name={provider} class="size-6" />
              <p class="max-w-65 text-sm text-pretty">
                Ask {providerLabel} to explore, explain, or change this project.
              </p>
            </div>
          {/each}
          {#if error}<p class="text-sm text-destructive" role="alert">
              {error}
            </p>{/if}
        </div>
      </div>
    {:else if view === 'terminal'}
      {#await import('../terminal-pane/terminal-pane.svelte') then { default: TerminalPane }}
        <TerminalPane sessionId={pane.sessionId} paneId={pane.id} />
      {/await}
    {:else}
      {#key view}<Inspector {session} initialMode={view} />{/key}
    {/if}
  </div>

  {#if view === 'chat'}
    <div class="shrink-0 px-4 pb-4">
      <div class="mx-auto max-w-3xl">
        <div class="flex px-0.5 pb-3">
          <BranchPicker {session} onswitch={onrefresh} />
        </div>
        <Composer
          paneId={pane.id}
          label={`Message ${providerLabel}`}
          {running}
          onsend={send}
        >
          <ModelSelect value={model} onchange={changeModel} />
          <EffortPicker bind:value={effort} />
          <ContextUsage {usage} {contextWindow} />
        </Composer>
      </div>
    </div>
  {/if}
</Card.Root>

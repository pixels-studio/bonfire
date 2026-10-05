<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount, tick, untrack } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import RequestView from '../conversation/request-view.svelte';
  import TurnView from '../conversation/turn-view.svelte';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import Composer from './composer.svelte';
  import ContextUsage from './context-usage.svelte';
  import ModelPicker from './model-picker.svelte';
  import QueuedPrompts from './queued-prompts.svelte';
  import { DEFAULT_CONTEXT_WINDOWS } from '$lib/models';
  import { catalog } from '$lib/stores/models.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import {
    DEFAULT_TITLE,
    PROVIDER_LABELS,
    errorMessage,
    isDefaultTitle,
    promptText,
    withoutMarkers,
    titleFrom,
  } from '$shared/domain';
  import type { PaneProps } from '$lib/panes';
  import type { PaneBadge } from '$lib/pane-status.svelte';
  import MatrixLoader from '$lib/components/matrix-loader/matrix-loader.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type {
    AssistantEvent,
    AssistantProvider,
    AssistantRequest,
    AssistantRespondInput,
    ConversationMessage,
    FollowUpMode,
    Pane,
    QueuedPrompt,
    ReasoningEffort,
    Usage,
  } from '$shared/contracts';

  let {
    pane,
    provider,
    dragHandle,
    onclose,
    onresize,
    onrename,
    badge,
  }: PaneProps & {
    pane: Pane;
    /** A status worth flagging on the header icon: needs input, failed, or done but unreviewed. */
    badge?: PaneBadge;
    /** The agent the conversation is with; the composer offers its models. */
    provider: AssistantProvider;
  } = $props();

  const providerLabel = $derived(PROVIDER_LABELS[provider]);

  let messages = $state<ConversationMessage[]>(
    untrack(() => [...pane.messages]),
  );
  let usage = $state<Usage | undefined>(untrack(() => pane.usage));
  let running = $state(false);
  let requests = $state<AssistantRequest[]>([]);
  let queue = $state<QueuedPrompt[]>([]);
  /** Spoken to screen readers in place of the streaming text, which would be read out token by token. */
  let announcement = $state('');
  let error = $state('');
  let feed = $state<HTMLDivElement>();
  let composer = $state<ReturnType<typeof Composer>>();
  let dragging = $state(false);

  function dragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragging = true;
  }
  let title = $state(
    untrack(() => (isDefaultTitle(pane.title) ? DEFAULT_TITLE : pane.title)),
  );
  let effort = $state<ReasoningEffort>(untrack(() => pane.reasoningEffort));
  let fast = $state(untrack(() => pane.fastMode));
  let model = $state(
    untrack(() => {
      const available = catalog.for(provider);
      return available.some((item) => item.value === pane.model)
        ? pane.model
        : available[0].value;
    }),
  );
  // The provider's own list can replace the built-in one after the pane has chosen a model.
  $effect(() => {
    const available = catalog.for(provider);
    if (!available.some((item) => item.value === model))
      model = available[0].value;
  });
  const fastSupported = $derived(!!catalog.find(model)?.supportsFast);
  /** The feed's vertical padding (`pt-6` + `pb-7`), excluded from the latest turn's height. */
  const FEED_PADDING = 52;
  /** Space kept above a new prompt when it is scrolled to the top (`scroll-mt-6`). */
  const TURN_MARGIN = 24;
  const contextWindow = $derived(
    usage?.contextWindow ??
      catalog.find(model)?.contextWindow ??
      DEFAULT_CONTEXT_WINDOWS[provider],
  );

  let feedHeight = $state(0);
  let latest = $state<HTMLDivElement>();
  let latestContent = $state<HTMLDivElement>();
  /** Whether the feed is kept scrolled to the end as the reply grows; scrolling up lets go. */
  let following = $state(true);

  /** The turns last worked out, whose unchanged arrays are handed out again. */
  let previousTurns: ConversationMessage[][] = [];
  /**
   * Messages split into turns, each starting at a run of user messages. A turn whose
   * messages are all as they were keeps its array, so a new message re-renders its own
   * turn rather than every turn of a long conversation.
   */
  const turns = $derived.by(() => {
    const result = messages.reduce<ConversationMessage[][]>(
      (result, item, index) => {
        const startsTurn =
          item.role === 'user' &&
          (index === 0 || messages[index - 1].role !== 'user');
        if (startsTurn || !result.length) result.push([item]);
        else result[result.length - 1].push(item);
        return result;
      },
      [],
    );
    const stable = result.map((turn, index) => {
      const previous = previousTurns[index];
      return previous?.length === turn.length &&
        previous.every((item, at) => item === turn[at])
        ? previous
        : turn;
    });
    previousTurns = stable;
    return stable;
  });
  const lastTurn = $derived(turns.at(-1) ?? []);
  /** Turns that ran while this view was open, keyed by their first message. They aren't folded afterwards. */
  let watched = $state<Record<string, true>>({});
  $effect(() => {
    if (running && lastTurn.length) watched[lastTurn[0].id] = true;
  });
  const assistantStarted = $derived(
    lastTurn.some((item) => item.role === 'assistant'),
  );

  function upsertMessage(message: ConversationMessage) {
    // Updates are nearly always to the latest messages, so the search starts from the end.
    const index = messages.findLastIndex((item) => item.id === message.id);
    if (index === -1) messages.push(message);
    else messages[index] = message;
    // Only a new prompt moves the feed; replies fill the space below it.
    // Scrolls the feed alone: `scrollIntoView` would also scroll the page, pushing the header off-screen.
    if (index === -1 && message.role === 'user')
      void tick().then(() => {
        if (feed && latest)
          feed.scrollTo({ top: latest.offsetTop - TURN_MARGIN });
      });
  }

  /** Adds streamed text to a message in place, so a long reply isn't re-sent whole. */
  function appendDelta(id: string, field: 'text' | 'output', text: string) {
    const message = messages.findLast((item) => item.id === id);
    if (!message) return;
    if (field === 'text') message.text += text;
    else if (message.tool) message.tool.output += text;
  }

  function handleEvent(event: AssistantEvent) {
    if (event.paneId !== pane.id) return;
    switch (event.type) {
      case 'message':
        upsertMessage(event.message);
        break;
      case 'delta':
        appendDelta(event.id, event.field, event.text);
        break;
      case 'usage':
        usage = event.usage;
        break;
      case 'status':
        running = event.status === 'running';
        if (event.status === 'running')
          announcement = `${providerLabel} is responding`;
        else if (event.status === 'failed')
          announcement = 'The response failed';
        else if (event.status === 'completed')
          announcement = 'Response complete';
        break;
      case 'request':
        if (!requests.some((item) => item.id === event.request.id))
          requests.push(event.request);
        announcement = `${providerLabel} is waiting for your response`;
        break;
      case 'request-resolved':
        requests = requests.filter((item) => item.id !== event.requestId);
        break;
      case 'queue':
        queue = event.queue;
        break;
      case 'title':
        title = event.title;
        break;
    }
  }

  async function respond(
    request: AssistantRequest,
    response: Pick<AssistantRespondInput, 'decision' | 'answers'>,
  ) {
    try {
      await window.bonfire.assistant.respond({
        paneId: pane.id,
        requestId: request.id,
        ...response,
      });
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  /** Keeps the end of a long reply in view, once it has outgrown the space under its prompt. */
  function followReply() {
    if (!following || !feed || !latest || !latestContent) return;
    const replyBottom = latest.offsetTop + latestContent.offsetHeight;
    if (replyBottom > feed.scrollTop + feed.clientHeight - FEED_PADDING / 2)
      feed.scrollTo({ top: feed.scrollHeight, behavior: 'instant' });
  }

  function trackFollowing() {
    if (!feed) return;
    following = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  }

  function scrollToBottom() {
    following = true;
    feed?.scrollTo({ top: feed.scrollHeight });
  }

  $effect(() => {
    if (!latestContent) return;
    const observer = new ResizeObserver(followReply);
    observer.observe(latestContent);
    return () => observer.disconnect();
  });

  async function send(
    text: string,
    attachmentIds: string[],
    skills: string[],
    followUp?: FollowUpMode,
  ) {
    const input = {
      paneId: pane.id,
      text,
      attachmentIds,
      skills,
      model,
      reasoningEffort: effort,
      fastMode: fast && fastSupported,
      approvals: preferences.current.approvals,
    };
    if (followUp) {
      // Resolves once the message is queued or has joined the running turn.
      try {
        await window.bonfire.assistant.send({ ...input, followUp });
      } catch (cause) {
        toast(errorMessage(cause), { variant: 'error' });
        throw cause;
      }
      return;
    }
    error = '';
    running = true;
    following = true;
    if (title === DEFAULT_TITLE)
      title = titleFrom(withoutMarkers(promptText(text, skills)));
    try {
      // Resolves when the turn ends; a rejection means it never started.
      await window.bonfire.assistant.send(input);
    } catch (cause) {
      error = errorMessage(cause);
      running = false;
      throw cause;
    }
  }

  async function runQueued(action: 'sendQueued' | 'unqueue', id: string) {
    try {
      await window.bonfire.assistant[action](pane.id, id);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  function changeModel(next: string) {
    if (next === model) return;
    model = next;
    // Once the model is known not to support it, fast mode is off rather than quietly remembered.
    if (catalog.find(next)?.supportsFast === false) fast = false;
    if (messages.length)
      toast(
        'FYI: When you switch models mid-chat, your next response will be slower and use more tokens.',
      );
  }

  onMount(() => {
    catalog.load();
    feed?.scrollTo({ top: feed.scrollHeight, behavior: 'instant' });
    const stop = window.bonfire.assistant.onEvent(handleEvent);
    // Events sent before this view mounted (or while the page reloaded) are caught up from main.
    void window.bonfire.assistant
      .snapshot(pane.id)
      .then((snapshot) => {
        const grew = snapshot.messages.length !== messages.length;
        messages = snapshot.messages;
        usage = snapshot.usage;
        running = snapshot.running;
        requests = snapshot.requests;
        queue = snapshot.queue;
        if (grew)
          void tick().then(() =>
            feed?.scrollTo({ top: feed.scrollHeight, behavior: 'instant' }),
          );
      })
      .catch(() => {});
    return stop;
  });
</script>

<!-- Dropping files anywhere on the pane attaches them. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative h-full min-w-0"
  ondragenter={dragOver}
  ondragover={dragOver}
  ondragleave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      dragging = false;
  }}
  ondrop={(event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    dragging = false;
    void composer?.addFiles([...event.dataTransfer.files]);
  }}
>
  {#if dragging}
    <div
      class="pointer-events-none absolute inset-0 z-50 grid place-items-center rounded-lg border-2 border-dashed border-brand bg-background/80 text-sm"
    >
      Drop to attach
    </div>
  {/if}
  <Card.Root class="h-full min-w-0">
    <PaneHeader
      {title}
      icon={provider}
      {badge}
      menuLabel="Conversation options"
      {dragHandle}
      {onresize}
      {onclose}
      {onrename}
    />

    <p class="sr-only" role="status">{announcement}</p>

    <div class="relative min-h-0 flex-1">
      <!-- No `content-visibility: auto` here: when a panel opening slid this feed to the
           strip's edge, Chromium flipped it between skipped and rendered every frame,
           never reaching paint, and the whole window froze. -->
      <div
        {@attach overlayScrollbar}
        bind:this={feed}
        bind:clientHeight={feedHeight}
        class="absolute inset-0 flex flex-col overflow-y-auto px-4 pt-6 pb-7 motion-safe:scroll-smooth"
        onscroll={trackFollowing}
      >
        <div
          class="@container mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6"
        >
          {#each turns.slice(0, -1) as turn (turn[0].id)}
            <TurnView messages={turn} expanded={!!watched[turn[0].id]} />
          {/each}
          {#if messages.length}
            <!-- The latest turn fills the feed so a new prompt can sit at the top. -->
            <div
              bind:this={latest}
              class="flex flex-col gap-6"
              style:min-height={`${Math.max(0, feedHeight - FEED_PADDING)}px`}
            >
              <div bind:this={latestContent} class="flex flex-col gap-6">
                <TurnView
                  messages={lastTurn}
                  expanded={!!watched[lastTurn[0].id]}
                />
                {#if running && !assistantStarted && !requests.length}
                  <p class="flex w-fit items-center gap-2 text-sm">
                    <MatrixLoader />
                    <span class="shimmer-text">Thinking</span>
                  </p>
                {/if}
                {#if error}<p class="text-sm text-destructive" role="alert">
                    {error}
                  </p>{/if}
              </div>
            </div>
          {:else}
            <div
              class="grid flex-1 place-content-center justify-items-center gap-1 text-center text-muted-foreground"
            >
              <Icon name={provider} class="size-6" />
              <p class="max-w-65 text-sm text-pretty">
                Ask {providerLabel} to explore, explain, or change this project.
              </p>
              {#if error}<p class="text-sm text-destructive" role="alert">
                  {error}
                </p>{/if}
            </div>
          {/if}
        </div>
      </div>
      {#if !following && messages.length}
        <Button
          variant="secondary"
          size="icon"
          aria-label="Scroll to bottom"
          onclick={scrollToBottom}
          class="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-md backdrop-blur-md"
        >
          <Icon name="chevron-down" />
        </Button>
      {/if}
    </div>

    <div class="shrink-0 px-4 pb-4">
      <div class="mx-auto max-w-3xl">
        {#if requests.length}
          <div class="flex flex-col gap-3 pb-3">
            {#each requests as request (request.id)}
              <RequestView
                {request}
                onrespond={(response) => respond(request, response)}
              />
            {/each}
          </div>
        {/if}
        {#if queue.length}
          <QueuedPrompts
            {queue}
            {running}
            onsend={(id) => runQueued('sendQueued', id)}
            onremove={(id) => runQueued('unqueue', id)}
          />
        {/if}
        <Composer
          bind:this={composer}
          paneId={pane.id}
          label={`Message ${providerLabel}`}
          {running}
          onsend={send}
        >
          <ModelPicker
            {provider}
            {model}
            bind:effort
            bind:fast
            {fastSupported}
            onmodel={changeModel}
          />
          <ContextUsage
            {usage}
            {contextWindow}
            disabled={running || !usage}
            oncompact={provider === 'claude'
              ? () => send('/compact', [], []).catch(() => {})
              : undefined}
          />
        </Composer>
      </div>
    </div>
  </Card.Root>
</div>

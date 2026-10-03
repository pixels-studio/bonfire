<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import RequestView from '../conversation/request-view.svelte';
  import TurnView from '../conversation/turn-view.svelte';
  import Inspector from '../inspector/inspector.svelte';
  import ApprovalPicker from './approval-picker.svelte';
  import AssistantHeader from './assistant-header.svelte';
  import BranchPicker from './branch-picker.svelte';
  import Composer from './composer.svelte';
  import ContextUsage from './context-usage.svelte';
  import EffortPicker from './effort-picker.svelte';
  import ModelSelect from './model-select.svelte';
  import ProjectPicker from './project-picker.svelte';
  import QueuedPrompts from './queued-prompts.svelte';
  import { DEFAULT_CONTEXT_WINDOWS } from '$lib/models';
  import { catalog } from '$lib/stores/models.svelte';
  import {
    DEFAULT_TITLE,
    PROVIDER_LABELS,
    errorMessage,
    isDefaultTitle,
    titleFrom,
  } from '$shared/domain';
  import type { PaneSize, PaneView } from '$lib/panes';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { toast } from '$lib/stores/toast.svelte';
  import type {
    ApprovalMode,
    AssistantEvent,
    AssistantProvider,
    AssistantRequest,
    AssistantRespondInput,
    ConversationMessage,
    FollowUpMode,
    Pane,
    Project,
    QueuedPrompt,
    ReasoningEffort,
    Session,
    Usage,
  } from '$shared/contracts';

  let {
    pane,
    session,
    projects,
    project,
    onselectproject,
    onaddproject,
    onremoveproject,
    dragHandle,
    onarchive,
    onresize,
    onrefresh,
    onswitchprovider,
    onretype,
  }: {
    pane: Pane;
    session?: Session;
    projects: Project[];
    project?: Project;
    onselectproject: (projectId: string) => void;
    onaddproject: () => void;
    onremoveproject: (projectId: string) => void;
    dragHandle: HTMLButtonAttributes;
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
  let requests = $state<AssistantRequest[]>([]);
  let queue = $state<QueuedPrompt[]>([]);
  /** Spoken to screen readers in place of the streaming text, which would be read out token by token. */
  let announcement = $state('');
  let error = $state('');
  let view = $state<PaneView>('chat');
  let feed = $state<HTMLDivElement>();
  let title = $state(
    untrack(() => (isDefaultTitle(pane.title) ? DEFAULT_TITLE : pane.title)),
  );
  let effort = $state<ReasoningEffort>(untrack(() => pane.reasoningEffort));
  let approvals = $state<ApprovalMode>(untrack(() => pane.approvals));
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
  /** The feed's vertical padding (`pt-6` + `pb-7`), excluded from the latest turn's height. */
  const FEED_PADDING = 52;
  const contextWindow = $derived(
    usage?.contextWindow ??
      catalog.find(model)?.contextWindow ??
      DEFAULT_CONTEXT_WINDOWS[provider],
  );

  let feedHeight = $state(0);
  let latest = $state<HTMLDivElement>();
  let latestContent = $state<HTMLDivElement>();
  /** Whether the feed is kept scrolled to the end as the reply grows; scrolling up lets go. */
  let following = true;

  /** Messages split into turns, each starting at a run of user messages. */
  const turns = $derived(
    messages.reduce<ConversationMessage[][]>((result, item, index) => {
      const startsTurn =
        item.role === 'user' &&
        (index === 0 || messages[index - 1].role !== 'user');
      if (startsTurn || !result.length) result.push([item]);
      else result[result.length - 1].push(item);
      return result;
    }, []),
  );
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
    const index = messages.findIndex((item) => item.id === message.id);
    if (index === -1) messages.push(message);
    else messages[index] = message;
    // Only a new prompt moves the feed; replies fill the space below it.
    if (index === -1 && message.role === 'user')
      void tick().then(() => latest?.scrollIntoView({ block: 'start' }));
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

  $effect(() => {
    if (!latestContent) return;
    const observer = new ResizeObserver(followReply);
    observer.observe(latestContent);
    return () => observer.disconnect();
  });

  async function send(
    text: string,
    attachmentIds: string[],
    followUp?: FollowUpMode,
  ) {
    const input = {
      paneId: pane.id,
      text,
      attachmentIds,
      model,
      reasoningEffort: effort,
      approvals,
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
    if (title === DEFAULT_TITLE) title = titleFrom(text);
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
    const target = catalog.find(next);
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

<Card.Root class="h-full min-w-0">
  <AssistantHeader
    {title}
    bind:view
    toolsDisabled={!session}
    {dragHandle}
    {onresize}
    {onarchive}
  />

  <p class="sr-only" role="status">{announcement}</p>

  <div class="relative min-h-0 flex-1">
    {#if view === 'chat'}
      <div
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
              class="flex scroll-mt-6 flex-col gap-6"
              style:min-height={`${Math.max(0, feedHeight - FEED_PADDING)}px`}
            >
              <div bind:this={latestContent} class="flex flex-col gap-6">
                <TurnView
                  messages={lastTurn}
                  expanded={!!watched[lastTurn[0].id]}
                />
                {#if running && !assistantStarted && !requests.length}
                  <p class="w-fit text-sm shimmer-text">Thinking</p>
                {/if}
                {#each requests as request (request.id)}
                  <RequestView
                    {request}
                    onrespond={(response) => respond(request, response)}
                  />
                {/each}
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
    {:else if !session}
      <!-- Tool views need a project; the header disables them until one is chosen. -->
    {:else if view === 'terminal'}
      {#await import('../terminal-pane/terminal-pane.svelte') then { default: TerminalPane }}
        <TerminalPane sessionId={session.id} paneId={pane.id} />
      {/await}
    {:else}
      {#key view}<Inspector {session} initialMode={view} />{/key}
    {/if}
  </div>

  {#if view === 'chat'}
    <div class="shrink-0 px-4 pb-4">
      <div class="mx-auto max-w-3xl">
        <div class="flex min-w-0 items-center gap-6 px-0.5 py-3">
          <ProjectPicker
            {projects}
            active={project}
            locked={messages.length > 0}
            onselect={onselectproject}
            onadd={onaddproject}
            onremove={onremoveproject}
          />
          {#if session}<BranchPicker {session} onswitch={onrefresh} />{/if}
        </div>
        {#if queue.length}
          <QueuedPrompts
            {queue}
            {running}
            onsend={(id) => runQueued('sendQueued', id)}
            onremove={(id) => runQueued('unqueue', id)}
          />
        {/if}
        <Composer
          paneId={pane.id}
          label={`Message ${providerLabel}`}
          {running}
          disabled={!session}
          onsend={send}
        >
          <ModelSelect value={model} onchange={changeModel} />
          <EffortPicker bind:value={effort} />
          <ApprovalPicker bind:value={approvals} />
          <ContextUsage {usage} {contextWindow} />
        </Composer>
      </div>
    </div>
  {/if}
</Card.Root>

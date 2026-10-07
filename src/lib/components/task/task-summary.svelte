<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import ActivityStepCard from './activity-step.svelte';
  import Markdown from '$lib/components/conversation/markdown.svelte';
  import { watchFiles } from '$lib/file-watch';
  import { assistantEvents } from '$lib/main-events';
  import { overlayScrollbar } from '$lib/scrollbar';
  import { preferences } from '$lib/stores/preferences.svelte';
  import type {
    AssistantEvent,
    AssistantProvider,
    Change,
    ConversationMessage,
    Pane,
    Workspace,
  } from '$shared/contracts';
  import {
    activitySteps,
    splitTaskSummary,
    summarySections,
    withoutMarkers,
  } from '$shared/domain';

  let {
    workspace,
    agentPaneId,
    agents,
    onviewChanges,
  }: {
    workspace: Workspace;
    /** The task's first agent, whose reading of the task the summary shows. */
    agentPaneId?: string;
    /** Every agent of the task, whose changes make up its activity. */
    agents: (Pane & { type: AssistantProvider })[];
    /** Opens the code diff pane on a file, or on the list without one. */
    onviewChanges: (path?: string) => void;
  } = $props();

  /** Each agent's conversation and whether a turn is running, kept current as it works. */
  let conversations = $state<
    Record<string, { messages: ConversationMessage[]; running: boolean }>
  >({});
  const messages = $derived(
    (agentPaneId && conversations[agentPaneId]?.messages) || [],
  );
  let changes = $state<Change[]>([]);

  /** What the user asked for: the request the task was made with, else the agent's first message. */
  const request = $derived(
    workspace.request ??
      withoutMarkers(
        messages.find(({ role, kind }) => role === 'user' && kind === 'text')
          ?.text ?? '',
      ),
  );

  /**
   * How the agent read the task: the summary block in its first reply, which is where it
   * says what it will do. A first reply with no block, as older tasks have, shows whole.
   * Later replies are about the work, not the task.
   */
  const understanding = $derived.by(() => {
    const firstUser = messages.findIndex(({ role }) => role === 'user');
    const reply = messages
      .slice(firstUser + 1)
      .find(({ role, kind }) => role === 'assistant' && kind === 'text');
    if (!reply) return '';
    const { summary } = splitTaskSummary(reply.text);
    return summary ?? reply.text.trim();
  });

  /** The pane's own name for each part of the agent's summary block. */
  const SUMMARY_HEADINGS: Record<string, string> = {
    understanding: 'The agent’s understanding',
    plan: 'Plan',
    needs: 'Needs from you',
  };
  /**
   * The summary's parts, each a section of the pane under the pane's heading for it, so the
   * block's own headings don't repeat the pane's. Text with no heading is the understanding.
   */
  const summaryParts = $derived(
    summarySections(understanding).map(({ heading, body }) => ({
      heading: heading
        ? (SUMMARY_HEADINGS[heading.toLowerCase()] ?? heading)
        : SUMMARY_HEADINGS.understanding,
      body,
    })),
  );

  // Every agent's messages, kept current as it works. It follows the agents' ids, so a
  // refresh of the pane list, which replaces its objects, doesn't reload them.
  const agentIds = $derived(agents.map(({ id }) => id).join('\n'));
  $effect(() => {
    const ids = agentIds ? agentIds.split('\n') : [];
    conversations = {};
    let current = true;
    const stops = ids.map((paneId) => {
      window.bonfire.assistant
        .snapshot(paneId)
        .then((snapshot) => {
          if (current)
            conversations[paneId] = {
              messages: snapshot.messages,
              running: snapshot.running,
            };
        })
        .catch(() => {});
      // Events before the snapshot are in it, so they are left to it.
      return assistantEvents.on(paneId, (event: AssistantEvent) => {
        const conversation = conversations[paneId];
        if (!conversation) return;
        if (event.type === 'message') {
          const list = conversation.messages;
          const index = list.findIndex(({ id }) => id === event.message.id);
          if (index >= 0) list[index] = event.message;
          else list.push(event.message);
        } else if (event.type === 'delta' && event.field === 'text') {
          const message = conversation.messages.findLast(
            ({ id }) => id === event.id,
          );
          if (message) message.text += event.text;
        } else if (event.type === 'status') {
          conversation.running = event.status === 'running';
        }
      });
    });
    return () => {
      current = false;
      for (const stop of stops) stop();
    };
  });

  /** A tool's path as Git names it: relative to the task's folder, with `/` between parts. */
  function gitPath(path: string) {
    const posix = (value: string) => value.replaceAll('\\', '/');
    const root = `${posix(workspace.path).replace(/\/+$/, '')}/`;
    const file = posix(path);
    return file.startsWith(root) ? file.slice(root.length) : file;
  }

  /**
   * The task's activity: each agent's turns that changed files, oldest first across
   * agents, each file with its current change. A turn with no reply time sorts last.
   */
  const activity = $derived.by(() => {
    const changeOf = new Map(changes.map((change) => [change.path, change]));
    return agents
      .flatMap((agent) => {
        const conversation = conversations[agent.id];
        if (!conversation) return [];
        return activitySteps(conversation.messages, conversation.running).map(
          (step) => ({
            // With Recap off, a step is its prompt and its files, even where a record exists.
            step: preferences.current.recap
              ? step
              : { ...step, activity: undefined },
            agent,
            files: step.paths.map(gitPath).map((path) => ({
              path,
              change: changeOf.get(path),
            })),
          }),
        );
      })
      .sort(
        (a, b) =>
          (a.step.startedAt ?? Infinity) - (b.step.startedAt ?? Infinity),
      );
  });

  // The task's uncommitted changes, as Git sees them, kept current as files change. They
  // give each step's files their counts; a failed look leaves the last counts in place.
  $effect(() => {
    const id = workspace.id;
    let generation = 0;
    changes = [];
    async function load() {
      const token = ++generation;
      const status = await window.bonfire.git.status(id).catch(() => undefined);
      if (status && token === generation) changes = status.changes;
    }
    void load();
    const stop = watchFiles(id, load);
    return () => {
      generation++;
      stop();
    };
  });

  const SECTION_HEADING = 'mb-2 text-sm text-muted-foreground';
</script>

<Card.Root class="flex h-full min-w-0 flex-col gap-0 py-0">
  <header class="flex h-12 shrink-0 items-center gap-2 px-4 pt-1">
    <h2 class="flex items-center gap-2 text-sm font-medium">
      <Icon name="summary" class="text-muted-foreground" />
      Summary
    </h2>
    <span
      class="ml-auto flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground"
      title={workspace.path}
    >
      <Icon name="branch" class="size-3.5 shrink-0" />
      <span class="truncate">{workspace.branch}</span>
      {#if workspace.base}
        <span class="shrink-0 opacity-70">→ {workspace.base}</span>
      {/if}
    </span>
  </header>
  <div
    {@attach overlayScrollbar}
    class="flex min-h-0 flex-1 flex-col gap-12 overflow-y-auto px-4 pt-6 pb-5"
  >
    <section>
      <h3 class={SECTION_HEADING}>You asked</h3>
      {#if request}
        <p class="line-clamp-8 text-sm whitespace-pre-wrap text-foreground">
          {request}
        </p>
      {:else}
        <p class="text-sm text-muted-foreground">No request yet.</p>
      {/if}
    </section>

    <!-- With Recap off the agent writes no plan, so its first reply isn't shown as one. -->
    {#if preferences.current.recap}
      {#each summaryParts as { heading, body }}
        <section>
          <h3 class={SECTION_HEADING}>{heading}</h3>
          <div class="text-sm text-foreground">
            <Markdown
              text={body}
              class="[--tw-prose-body:var(--color-foreground)]"
            />
          </div>
        </section>
      {:else}
        <section>
          <h3 class={SECTION_HEADING}>The agent’s understanding</h3>
          {#if agentPaneId}
            <p class="text-sm text-muted-foreground">
              The agent hasn’t replied yet.
            </p>
          {:else}
            <p class="text-sm text-muted-foreground">
              No agent is on this task.
            </p>
          {/if}
        </section>
      {/each}
    {/if}

    {#if activity.length}
      <section>
        <h3 class={SECTION_HEADING}>Activity</h3>
        <!-- A timeline: each step's number on a dashed line that runs down to the next. -->
        <ol class="mt-4">
          {#each activity as { agent, step, files }, index (`${agent.id}:${step.id}`)}
            {@const last = index === activity.length - 1}
            <li class="flex gap-3">
              <div class="flex flex-col items-center" aria-hidden="true">
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs text-secondary-foreground tabular-nums"
                >
                  {index + 1}
                </span>
                {#if !last}
                  <span
                    class="my-1.5 flex-1 border-l border-dashed border-border"
                  ></span>
                {/if}
              </div>
              <div class={['min-w-0 flex-1', !last && 'pb-10']}>
                <ActivityStepCard {step} {files} {onviewChanges} />
              </div>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  </div>
</Card.Root>

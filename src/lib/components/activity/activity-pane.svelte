<script lang="ts" module>
  const STATS = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  /** A line count as the list shows it: 22, 735, 1.5k, 4.2k. */
  function formatLines(count: number) {
    return STATS.format(count).toLowerCase();
  }

  function startOfDay(at: number) {
    const date = new Date(at);
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
  }

  /** "Today", "Yesterday", else the date, with the year once it isn't this one. */
  function dayLabel(day: number, now = Date.now()) {
    const today = startOfDay(now);
    if (day === today) return 'Today';
    if (day === startOfDay(today - 1)) return 'Yesterday';
    const date = new Date(day);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year:
        date.getFullYear() === new Date(now).getFullYear()
          ? undefined
          : 'numeric',
    });
  }
</script>

<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PanelProps } from '$lib/panes';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn } from '$lib/utils';
  import { errorMessage } from '$shared/domain';
  import type { Activity } from '$shared/contracts';

  let {
    projectId,
    dragHandle,
    onresize,
    onclose,
  }: { projectId?: string } & PanelProps = $props();

  let items = $state<Activity[]>();
  let error = $state<string>();
  let loading = $state(false);
  /** Avatars that failed to load, shown as a blank circle instead. */
  let brokenAvatars = $state<Record<string, boolean>>({});

  /** Pull requests grouped by the day they last changed, newest day first. */
  const days = $derived.by(() => {
    const groups = new Map<number, Activity[]>();
    for (const item of items ?? []) {
      const day = startOfDay(item.at);
      groups.set(day, [...(groups.get(day) ?? []), item]);
    }
    return [...groups].map(([day, activity]) => ({
      day,
      label: dayLabel(day),
      activity,
    }));
  });

  /** Only the newest request lands, so switching projects quickly can't show the wrong list. */
  let request = 0;

  async function load(id: string | undefined) {
    const current = ++request;
    error = undefined;
    if (!id) {
      items = [];
      return;
    }
    loading = true;
    try {
      const result = await window.bonfire.github.activity(id);
      if (current === request) items = result;
    } catch (cause) {
      if (current === request) error = errorMessage(cause);
    } finally {
      if (current === request) loading = false;
    }
  }

  /** Clears the list, so the skeleton shows, and reads it again. */
  function reload(id: string | undefined) {
    items = undefined;
    void load(id);
  }

  $effect(() => reload(projectId));

  /** Who pushed it and how, for the row's tooltip. */
  function describe(item: Activity) {
    const by = item.author ? ` by ${item.author}` : '';
    if (item.kind === 'push') return `Pushed to the default branch${by}`;
    const number = item.url.split('/').pop();
    return `Pull request #${number}${by} · ${item.state}`;
  }

  function open(item: Activity) {
    window.bonfire.github
      .openActivity(item.url)
      .catch((cause) =>
        toast(errorMessage(cause), { variant: 'error', duration: 0 }),
      );
  }
</script>

<Card.Root class="h-full min-w-0 gap-0" role="region" aria-label="Activity">
  <PaneHeader
    title="Activity"
    icon="activity"
    {dragHandle}
    {onresize}
    {onclose}
  >
    {#snippet actions()}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="secondary"
            size="icon"
            class="text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
            disabled={loading || !projectId}
            onclick={() => reload(projectId)}
          >
            <Icon name="refresh" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Refresh</Tooltip.Content>
    </Tooltip.Root>
    {/snippet}
  </PaneHeader>
  <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
    {#if error}
      <p
        class="px-2 py-8 text-center text-sm text-pretty text-muted-foreground"
      >
        {error}
      </p>
    {:else if !items}
      <div class="px-2" role="status" aria-label="Loading activity">
        <div class="mb-3 h-4 w-24 rounded bg-muted"></div>
        {#each { length: 6 }, index (index)}
          <div class="flex h-11 items-center gap-3">
            <div class="size-6 shrink-0 rounded-full bg-muted"></div>
            <div
              class="h-3.5 rounded bg-muted"
              style:width={`${40 + ((index * 17) % 35)}%`}
            ></div>
          </div>
        {/each}
      </div>
    {:else if !projectId}
      <p class="py-8 text-center text-sm text-muted-foreground">
        Open a project to see its activity.
      </p>
    {:else}
      {#each days as { day, label, activity } (day)}
        <section class="not-first:mt-12" aria-label={label}>
          <h3 class="mb-1 flex items-baseline gap-2 px-2 text-sm">
            {label}
            <span class="text-muted-foreground">{activity.length}</span>
          </h3>
          <ul>
            {#each activity as item (item.id)}
              <li>
                <button
                  type="button"
                  class="flex h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm outline-none transition-colors duration-150 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/60"
                  title={describe(item)}
                  onclick={() => open(item)}
                >
                  {#if item.avatarUrl && !brokenAvatars[item.avatarUrl]}
                    <img
                      src={item.avatarUrl}
                      alt={item.author}
                      class="size-6 shrink-0 rounded-full bg-muted"
                      loading="lazy"
                      onerror={() => (brokenAvatars[item.avatarUrl!] = true)}
                    />
                  {:else}
                    <span class="size-6 shrink-0 rounded-full bg-muted"></span>
                  {/if}
                  <span
                    class={cn(
                      'min-w-0 flex-1 truncate',
                      item.state === 'closed' && 'text-muted-foreground',
                    )}
                  >
                    {item.title}
                  </span>
                  {#if item.additions || item.deletions}
                    <span
                      class="flex shrink-0 gap-1.5 font-mono text-xs tabular-nums"
                    >
                      {#if item.additions}
                        <span class="text-success"
                          >+{formatLines(item.additions)}</span
                        >
                      {/if}
                      {#if item.deletions}
                        <span class="text-destructive"
                          >-{formatLines(item.deletions)}</span
                        >
                      {/if}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {:else}
        <p class="py-8 text-center text-sm text-muted-foreground">
          Nothing has been pushed to this repository yet.
        </p>
      {/each}
    {/if}
  </div>
</Card.Root>

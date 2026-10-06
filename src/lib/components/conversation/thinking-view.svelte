<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';
  import ThinkingIcon from '$lib/components/icon/thinking-icon.svelte';
  import MatrixLoader from '$lib/components/matrix-loader/matrix-loader.svelte';
  import Markdown from './markdown.svelte';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
  const streaming = $derived(message.status === 'streaming');
  /** The text is built once first opened, so streaming thinking costs nothing while closed. */
  let opened = $state(false);

  const seconds = $derived(
    message.durationMs === undefined
      ? null
      : Math.max(1, Math.round(message.durationMs / 1000)),
  );

  const label = $derived(
    streaming
      ? 'Thinking'
      : seconds === null
        ? 'Thought process'
        : `Thought for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`,
  );
</script>

<details class="group text-sm text-muted-foreground">
  <summary
    onclick={() => (opened = true)}
    class="flex w-fit cursor-pointer list-none items-center gap-2 hover:text-foreground [&::-webkit-details-marker]:hidden"
  >
    {#if streaming}
      <span class="grid size-4 shrink-0 place-items-center">
        <MatrixLoader variant="twinkle" size="sm" />
      </span>
    {:else}
      <ThinkingIcon class="size-4 shrink-0" />
    {/if}
    <span class={streaming ? 'shimmer-text' : ''}>
      {label}
    </span>
    <Icon
      name="chevron-down"
      class="size-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
    />
  </summary>
  {#if opened && message.text}
    <Markdown
      text={message.text}
      class="mt-2 border-l border-dashed border-border pl-6 prose-muted thinking-steps"
    />
  {/if}
</details>

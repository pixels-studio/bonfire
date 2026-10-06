<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import type { ShortcutId } from '$lib/shortcuts';
  import { PROVIDER_LABELS } from '$shared/domain';
  import type { AssistantProvider, PaneType } from '$shared/contracts';

  let {
    title,
    subtitle,
    providers,
    startingProvider,
    canAddTerminal = true,
    disabled = false,
    onadd,
  }: {
    title: string;
    subtitle: string;
    /** The agents that are turned on, in the order they are offered. */
    providers: AssistantProvider[];
    /** The agent ⌘N opens; ⇧⌘N opens the other one. */
    startingProvider: AssistantProvider;
    canAddTerminal?: boolean;
    disabled?: boolean;
    onadd: (type: PaneType) => void;
  } = $props();

  type Choice = {
    type: PaneType;
    label: string;
    hint: string;
    shortcut: ShortcutId;
    disabled?: boolean;
  };

  const choices = $derived<Choice[]>([
    ...providers.map((provider): Choice => ({
      type: provider,
      label: PROVIDER_LABELS[provider],
      hint: 'Agent',
      shortcut:
        provider === startingProvider ? 'newConversation' : 'newOtherAgent',
    })),
    {
      type: 'terminal',
      label: 'Terminal',
      hint: 'Shell',
      shortcut: 'newTerminal',
      disabled: !canAddTerminal,
    },
  ]);
</script>

<Card.Root
  class="grid h-full place-content-center justify-items-center gap-0 px-6 text-center"
  role="region"
  aria-label="New pane"
>
  <h2 class="font-medium text-pretty text-foreground">{title}</h2>
  <p class="mt-1 max-w-80 text-sm text-pretty text-muted-foreground">
    {subtitle}
  </p>
  <div class="mt-6 grid w-64 gap-2">
    {#each choices as choice (choice.type)}
      <button
        type="button"
        class="group flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5 text-left text-sm transition-colors outline-none hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled || choice.disabled}
        onclick={() => onadd(choice.type)}
      >
        <Icon
          name={choice.type}
          class="text-muted-foreground transition-colors group-hover:text-foreground"
        />
        <span class="flex-1">
          {choice.label}
          <span class="text-muted-foreground"> · {choice.hint}</span>
        </span>
        <ShortcutKeys id={choice.shortcut} />
      </button>
    {/each}
  </div>
</Card.Root>

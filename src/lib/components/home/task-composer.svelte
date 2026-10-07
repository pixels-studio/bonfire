<script lang="ts" module>
  /** What a task is made from: what to do, where to start, and who does it. */
  export type TaskDraft = {
    request: string;
    /** The branch to start from and merge back into; the default branch when unset. */
    base?: string;
    provider: AssistantProvider;
    model: string;
  };
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';
  import Icon from '$lib/components/icon/icon.svelte';
  import { catalog } from '$lib/stores/models.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { cn } from '$lib/utils';
  import type { AssistantProvider, State } from '$shared/contracts';
  import { PROVIDER_LABELS, startingProvider } from '$shared/domain';

  let {
    projectId,
    settings,
    disabled = false,
    oncreate,
    textarea = $bindable(),
  }: {
    projectId: string;
    /** What the last task or message used, which a new task starts with. */
    settings: State['settings'];
    disabled?: boolean;
    oncreate: (draft: TaskDraft) => void;
    textarea?: HTMLTextAreaElement;
  } = $props();

  let request = $state('');
  let branches = $state<string[]>([]);
  let base = $state<string>();
  let loadingBranches = $state(false);
  let chosenModel = $state<string>();

  // Each project has its own branches; the default one is picked to start with.
  $effect(() => {
    const id = projectId;
    let current = true;
    loadingBranches = true;
    branches = [];
    base = undefined;
    window.bonfire.projects
      .branches(id)
      .then((result) => {
        if (!current) return;
        branches = result.branches;
        base = result.default ?? result.branches[0];
      })
      .catch(() => {})
      .finally(() => {
        if (current) loadingBranches = false;
      });
    return () => {
      current = false;
    };
  });

  $effect(() => catalog.load());

  /** The model new tasks start with: the chosen default, else the last used, else the provider's first. */
  const startingModel = $derived.by(() => {
    const { defaultModel } = preferences.current;
    if (defaultModel && preferences.current.providers[defaultModel.provider])
      return defaultModel.model;
    const provider = startingProvider(
      preferences.current,
      settings.lastProvider,
    );
    return (
      settings.lastModels?.[provider] ?? catalog.for(provider)[0]?.value ?? ''
    );
  });
  const model = $derived(
    catalog.find(chosenModel ?? '') ?? catalog.find(startingModel),
  );

  const branchItems = $derived(
    branches.map((name) => ({ value: name, label: name })),
  );
  const modelItems = $derived(
    preferences.enabledProviders.flatMap((provider) => catalog.for(provider)),
  );

  const ready = $derived(!!request.trim() && !!model && !disabled);

  function submit() {
    if (!ready || !model) return;
    oncreate({
      request: request.trim(),
      base,
      provider: model.provider,
      model: model.value,
    });
    request = '';
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submit();
  }

  const PICKER_CLASS =
    'h-8 w-auto max-w-56 gap-1.5 rounded-full border-none bg-transparent px-2 text-sm text-muted-foreground shadow-none hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted';
</script>

<form
  class="flex flex-col rounded-xl bg-card"
  onsubmit={(event) => {
    event.preventDefault();
    submit();
  }}
>
  <label for="task-request" class="sr-only">What should the agent do?</label>
  <textarea
    id="task-request"
    bind:this={textarea}
    bind:value={request}
    {onkeydown}
    rows="4"
    placeholder="Describe a task…"
    class="field-sizing-content max-h-80 min-h-28 w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base outline-none placeholder:text-muted-foreground"
  ></textarea>
  <div class="flex items-center gap-1 px-2 pb-2">
    <Select.Root
      type="single"
      items={branchItems}
      value={base ?? ''}
      onValueChange={(next) => (base = next || undefined)}
      disabled={loadingBranches || !branches.length}
    >
      <Select.Trigger
        class={PICKER_CLASS}
        aria-label="Target branch"
        title="The branch the task starts from and merges into"
      >
        <Icon name="branch" class="size-4 shrink-0" />
        <span class="truncate">
          {loadingBranches ? 'Loading…' : (base ?? 'Default branch')}
        </span>
      </Select.Trigger>
      <Select.Content class="max-h-72">
        {#each branches as name (name)}
          <Select.Item value={name} label={name} />
        {/each}
      </Select.Content>
    </Select.Root>
    <Select.Root
      type="single"
      items={modelItems}
      value={model?.value ?? ''}
      onValueChange={(next) => (chosenModel = next)}
    >
      <Select.Trigger
        class={PICKER_CLASS}
        aria-label="Model"
        title="The agent the task is assigned to"
      >
        {#if model}
          <Icon name={model.provider} class="size-4 shrink-0" />
        {/if}
        <span class="truncate">
          {#if model}
            {PROVIDER_LABELS[model.provider]} · {model.label}
          {:else}
            Choose a model
          {/if}
        </span>
      </Select.Trigger>
      <Select.Content>
        {#each preferences.enabledProviders as provider (provider)}
          <Select.Group>
            <Select.GroupHeading
              >{PROVIDER_LABELS[provider]}</Select.GroupHeading
            >
            {#each catalog.for(provider) as option (option.value)}
              <Select.Item value={option.value} label={option.label} />
            {/each}
          </Select.Group>
        {/each}
      </Select.Content>
    </Select.Root>
    <Button
      type="submit"
      size="sm"
      class={cn('ml-auto min-w-16')}
      disabled={!ready}
    >
      Add
    </Button>
  </div>
</form>

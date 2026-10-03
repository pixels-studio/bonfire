<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import type { AssistantRequest, Question } from '$shared/contracts';

  let {
    request,
    onrespond,
  }: {
    request: AssistantRequest;
    onrespond: (
      response:
        | { decision: 'allow' | 'allow-session' | 'deny' }
        | { answers: Record<string, string[]> },
    ) => void;
  } = $props();

  let selected = $state<Record<string, string[]>>({});
  let typed = $state<Record<string, string>>({});
  /** Questions whose "Other" row is picked; a question without options is always answering in its own words. */
  let other = $state<Record<string, boolean>>({});

  /** Stands in for the "Other" row as a radio value, which an option label can't collide with. */
  const OTHER = '\0other';

  const isOther = ({ id, options }: Question) => !options.length || !!other[id];

  /** What the user chose for a question; typed text replaces a single choice and joins multiple. */
  function answerTo(question: Question) {
    const { id, multiple } = question;
    const text = typed[id]?.trim();
    const chosen = selected[id] ?? [];
    if (!text || !isOther(question)) return chosen;
    return multiple ? [...chosen, text] : [text];
  }

  function choose({ id, multiple }: Question, label: string, on: boolean) {
    const chosen = selected[id] ?? [];
    selected[id] = multiple
      ? on
        ? [...chosen, label]
        : chosen.filter((item) => item !== label)
      : [label];
    if (!multiple) other[id] = false;
  }

  function chooseOther({ id, multiple }: Question, on: boolean) {
    other[id] = on;
    if (!multiple) selected[id] = [];
  }

  const answered = $derived(
    request.kind === 'question' &&
      request.questions.every((question) => answerTo(question).length > 0),
  );

  function submit() {
    if (request.kind !== 'question') return;
    onrespond({
      answers: Object.fromEntries(
        request.questions.map((question) => [question.id, answerTo(question)]),
      ),
    });
  }
</script>

{#snippet tag(label: string)}
  <span
    class="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
    >{label}</span
  >
{/snippet}

{#snippet choice(label: string, description?: string)}
  <span class="flex min-w-0 flex-col">
    <span>{label}</span>
    {#if description}
      <span class="text-muted-foreground">{description}</span>
    {/if}
  </span>
{/snippet}

<section
  class="flex min-w-0 flex-col gap-3 rounded-xl bg-composer wrap-anywhere p-4 text-sm"
  aria-labelledby={`request-${request.id}`}
>
  {#if request.kind === 'approval'}
    <p id={`request-${request.id}`} class="font-medium">{request.title}</p>
    {#if request.detail}
      <pre
        class="max-h-40 overflow-auto rounded-lg bg-foreground/8 px-2.5 py-2 font-mono text-xs/5 whitespace-pre-wrap text-foreground/80 wrap-anywhere">{request.detail}</pre>
    {/if}
    {#if request.reason}
      <p class="text-muted-foreground">{request.reason}</p>
    {/if}
    <div class="flex flex-wrap items-center justify-between gap-2">
      {#if request.canRemember}
        <Button
          class="rounded-full"
          size="sm"
          variant="secondary"
          onclick={() => onrespond({ decision: 'allow-session' })}
        >
          Allow for this session
        </Button>
      {/if}
      <div class="ml-auto flex gap-2">
        <Button
          class="rounded-full"
          size="sm"
          variant="secondary"
          onclick={() => onrespond({ decision: 'deny' })}
        >
          Deny
        </Button>
        <Button
          class="rounded-full"
          size="sm"
          onclick={() => onrespond({ decision: 'allow' })}
        >
          Allow
        </Button>
      </div>
    </div>
  {:else}
    <form
      class="flex flex-col gap-4"
      aria-labelledby={`request-${request.id}`}
      onsubmit={(event) => {
        event.preventDefault();
        if (answered) submit();
      }}
    >
      <div class="flex items-baseline justify-between gap-2">
        <p id={`request-${request.id}`} class="font-medium">
          {request.questions.length === 1
            ? request.questions[0].question
            : 'Answer to continue'}
        </p>
        {#if request.questions.length === 1}
          {@render tag(request.questions[0].header)}
        {/if}
      </div>
      {#each request.questions as question (question.id)}
        <fieldset class="flex min-w-0 flex-col gap-2">
          <legend
            class={request.questions.length === 1
              ? 'sr-only'
              : 'mb-1 flex w-full items-baseline justify-between gap-2'}
          >
            <span>{question.question}</span>
            {#if request.questions.length > 1}
              {@render tag(question.header)}
            {/if}
          </legend>
          {#if question.multiple}
            {#each question.options as option (option.label)}
              <label class="flex cursor-pointer items-start gap-2">
                <Checkbox
                  class="mt-0.5"
                  checked={!!selected[question.id]?.includes(option.label)}
                  onCheckedChange={(on) => choose(question, option.label, on)}
                />
                {@render choice(option.label, option.description)}
              </label>
            {/each}
            <label class="flex cursor-pointer items-start gap-2">
              <Checkbox
                class="mt-0.5"
                checked={!!other[question.id]}
                onCheckedChange={(on) => chooseOther(question, on)}
              />
              {@render choice('Other')}
            </label>
          {:else if question.options.length}
            <RadioGroup.Root
              value={other[question.id]
                ? OTHER
                : (selected[question.id]?.[0] ?? '')}
              onValueChange={(value) =>
                value === OTHER
                  ? chooseOther(question, true)
                  : choose(question, value, true)}
            >
              {#each question.options as option (option.label)}
                <label class="flex cursor-pointer items-start gap-2">
                  <RadioGroup.Item class="mt-0.5" value={option.label} />
                  {@render choice(option.label, option.description)}
                </label>
              {/each}
              <label class="flex cursor-pointer items-start gap-2">
                <RadioGroup.Item class="mt-0.5" value={OTHER} />
                {@render choice('Other')}
              </label>
            </RadioGroup.Root>
          {/if}
          {#if isOther(question)}
            <input
              class="rounded-lg border border-border bg-transparent px-3 py-1.5 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              type="text"
              placeholder="Your answer"
              aria-label={`${question.header}: your answer`}
              bind:value={typed[question.id]}
              {@attach (node) => {
                if (question.options.length) node.focus();
              }}
            />
          {/if}
        </fieldset>
      {/each}
      <div class="flex justify-end gap-2">
        <Button
          class="rounded-full"
          type="button"
          size="sm"
          variant="secondary"
          onclick={() => onrespond({ answers: {} })}
        >
          Skip
        </Button>
        <Button
          class="rounded-full"
          type="submit"
          size="sm"
          disabled={!answered}>Send answer</Button
        >
      </div>
    </form>
  {/if}
</section>

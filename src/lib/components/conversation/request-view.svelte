<script lang="ts">
  import { fly } from 'svelte/transition';
  import { expoOut } from 'svelte/easing';
  import { MediaQuery } from 'svelte/reactivity';
  import { overlayScrollbar } from '$lib/scrollbar';
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

  /** 20px filled circle: faint when empty, accent once picked (the dot / check is drawn by the control). */
  const control =
    'size-5 border-0 bg-foreground/10 data-[state=checked]:bg-brand';

  /** Stands in for the "Other" row as a radio value, which an option label can't collide with. */
  const OTHER = '\0other';

  const isOther = ({ id, options }: Question) => !options.length || !!other[id];

  /** What the user chose for a question; typed text replaces a single choice and joins multiple. */
  function answerTo(question: Question) {
    const { id, multiple } = question;
    const text = typed[id]?.trim();
    // A plain copy: the answer crosses IPC, which can't clone a `$state` proxy.
    const chosen = [...(selected[id] ?? [])];
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

  /** Multiple questions are asked one at a time; this is the index of the one showing. */
  let step = $state(0);
  /** Height of the question showing, including an opened "Other" input. */
  let contentHeight = $state(0);
  /** +1 moving forward, -1 back; decides which side the next question slides in from. */
  let direction = $state(1);
  const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
  const slide = (side: 1 | -1) => ({
    x: reduceMotion.current ? 0 : 32 * direction * side,
    // Enter 200ms, exit 150ms, like `dialog-motion`. Reduced motion keeps the fade.
    duration: side === 1 ? 200 : 150,
    easing: expoOut,
  });

  function go(delta: 1 | -1) {
    direction = delta;
    step += delta;
  }
  const questions = $derived(
    request.kind === 'question' ? request.questions : [],
  );
  const current = $derived(questions[step]);
  const isLast = $derived(step >= questions.length - 1);
  const currentAnswered = $derived(!!current && answerTo(current).length > 0);

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
        {@attach overlayScrollbar}
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
      class="flex flex-col gap-6"
      aria-labelledby={`request-${request.id}`}
      onsubmit={(event) => {
        event.preventDefault();
        if (!currentAnswered) return;
        if (!isLast) go(1);
        else if (answered) submit();
      }}
    >
      {#if request.questions.length === 1}
        <div class="flex items-baseline justify-between gap-2">
          <p id={`request-${request.id}`} class="font-medium">
            {request.questions[0].question}
          </p>
          {@render tag(request.questions[0].header)}
        </div>
      {:else}
        <p id={`request-${request.id}`} class="sr-only">Answer to continue</p>
      {/if}
      <!-- Both questions share one grid cell while sliding; the height follows the one
           arriving, so the card grows or shrinks instead of jumping. The padding keeps
           focus rings from being clipped. -->
      <div
        class="-m-1 grid overflow-clip p-1 transition-[height] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none"
        style:height={contentHeight ? `${contentHeight + 8}px` : undefined}
      >
        {#each [current] as question (question.id)}
          <fieldset
            bind:offsetHeight={contentHeight}
            class="col-start-1 row-start-1 flex min-w-0 flex-col gap-6"
            in:fly={slide(1)}
            out:fly={slide(-1)}
          >
            <legend
              class={request.questions.length === 1 ? 'sr-only' : 'mb-6 w-full'}
            >
              {#if request.questions.length > 1}
                <span
                  class="flex items-baseline justify-between gap-2 text-muted-foreground"
                >
                  <span>Question {step + 1} of {request.questions.length}</span>
                  {@render tag(question.header)}
                </span>
              {/if}
              <span
                class={request.questions.length > 1 ? 'block font-medium' : ''}
                >{question.question}</span
              >
            </legend>
            {#if question.multiple}
              {#each question.options as option (option.label)}
                <label class="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    class={control}
                    checked={!!selected[question.id]?.includes(option.label)}
                    onCheckedChange={(on) => choose(question, option.label, on)}
                  />
                  {@render choice(option.label, option.description)}
                </label>
              {/each}
              <label class="flex cursor-pointer items-start gap-2">
                <Checkbox
                  class={control}
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
                    <RadioGroup.Item class={control} value={option.label} />
                    {@render choice(option.label, option.description)}
                  </label>
                {/each}
                <label class="flex cursor-pointer items-start gap-2">
                  <RadioGroup.Item class={control} value={OTHER} />
                  {@render choice('Other')}
                </label>
              </RadioGroup.Root>
            {/if}
            {#if isOther(question)}
              <input
                class="-mt-4 rounded-lg border border-border bg-transparent px-3 py-1.5 outline-none placeholder:text-muted-foreground focus-visible:border-brand"
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
      </div>
      <div class="flex items-center justify-between gap-2">
        {#if step > 0}
          <Button
            class="min-w-20 rounded-full"
            type="button"
            size="sm"
            variant="secondary"
            onclick={() => go(-1)}
          >
            Back
          </Button>
        {/if}
        <div class="ml-auto flex gap-2">
          <Button
            class="min-w-20 rounded-full"
            type="button"
            size="sm"
            variant="secondary"
            onclick={() => onrespond({ answers: {} })}
          >
            Skip
          </Button>
          <Button
            class="min-w-20 rounded-full"
            type="submit"
            size="sm"
            disabled={!currentAnswered}
            >{isLast ? 'Send answer' : 'Next'}</Button
          >
        </div>
      </div>
    </form>
  {/if}
</section>

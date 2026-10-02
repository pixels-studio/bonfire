<script lang="ts">
  import { Button } from '$lib/components/ui/button';
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

  /** What the user chose for a question; typed text replaces a single choice and joins multiple. */
  function answerTo({ id, multiple }: Question) {
    const text = typed[id]?.trim();
    const chosen = selected[id] ?? [];
    if (!text) return chosen;
    return multiple ? [...chosen, text] : [text];
  }

  function choose({ id, multiple }: Question, label: string, on: boolean) {
    const chosen = selected[id] ?? [];
    selected[id] = multiple
      ? on
        ? [...chosen, label]
        : chosen.filter((item) => item !== label)
      : [label];
    if (!multiple) typed[id] = '';
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

<section
  class="flex flex-col gap-3 rounded-xl border border-warning/40 bg-surface-raised p-4 text-sm"
  aria-labelledby={`request-${request.id}`}
>
  {#if request.kind === 'approval'}
    <p id={`request-${request.id}`} class="font-medium">{request.title}</p>
    {#if request.detail}
      <pre
        class="max-h-40 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs/5 whitespace-pre-wrap text-foreground/80 wrap-anywhere">{request.detail}</pre>
    {/if}
    {#if request.reason}
      <p class="text-muted-foreground">{request.reason}</p>
    {/if}
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={() => onrespond({ decision: 'allow' })}>
        Allow
      </Button>
      {#if request.canRemember}
        <Button
          size="sm"
          variant="secondary"
          onclick={() => onrespond({ decision: 'allow-session' })}
        >
          Allow for this session
        </Button>
      {/if}
      <Button
        size="sm"
        variant="ghost"
        onclick={() => onrespond({ decision: 'deny' })}
      >
        Deny
      </Button>
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
      <p id={`request-${request.id}`} class="font-medium">Answer to continue</p>
      {#each request.questions as question (question.id)}
        <fieldset class="flex min-w-0 flex-col gap-2">
          <legend class="mb-1 flex items-baseline gap-2">
            <span
              class="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >{question.header}</span
            >
            <span>{question.question}</span>
          </legend>
          {#each question.options as option (option.label)}
            <label class="flex cursor-pointer items-start gap-2">
              <input
                class="mt-1 accent-brand"
                type={question.multiple ? 'checkbox' : 'radio'}
                name={`${request.id}-${question.id}`}
                checked={selected[question.id]?.includes(option.label) &&
                  !(typed[question.id]?.trim() && !question.multiple)}
                onchange={(event) =>
                  choose(question, option.label, event.currentTarget.checked)}
              />
              <span class="flex min-w-0 flex-col">
                <span>{option.label}</span>
                {#if option.description}
                  <span class="text-muted-foreground">{option.description}</span
                  >
                {/if}
              </span>
            </label>
          {/each}
          <input
            class="rounded-lg border border-border bg-background px-3 py-1.5 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            type="text"
            placeholder={question.options.length ? 'Other…' : 'Your answer'}
            aria-label={`${question.header}: other answer`}
            bind:value={typed[question.id]}
            oninput={() => {
              if (!question.multiple && typed[question.id]?.trim())
                selected[question.id] = [];
            }}
          />
        </fieldset>
      {/each}
      <div class="flex gap-2">
        <Button type="submit" size="sm" disabled={!answered}>Send answer</Button
        >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onclick={() => onrespond({ answers: {} })}
        >
          Skip
        </Button>
      </div>
    </form>
  {/if}
</section>

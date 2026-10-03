<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import Logo from '$lib/components/logo/logo.svelte';
  import Backdrop from './backdrop.svelte';
  import GithubCard from './github-card.svelte';
  import ProjectStep, { FORM_ID } from './project-step.svelte';
  import ProviderCard from './provider-card.svelte';
  import type {
    AssistantProvider,
    GithubStatus,
    Project,
    ProviderAccount,
  } from '$shared/contracts';
  import { cn, reducedMotion } from '$lib/utils';

  type Step = 'agents' | 'github' | 'project';

  let {
    accounts = $bindable(),
    accountErrors = $bindable(),
    hasProjects,
    onfinish,
  }: {
    /** Each provider's account; unset while it is being checked. */
    accounts: Partial<Record<AssistantProvider, ProviderAccount>>;
    accountErrors: Partial<Record<AssistantProvider, string>>;
    /** With projects already added, only signing in to an agent is left. */
    hasProjects: boolean;
    /** Done: an agent is signed in and there is a project to work in. */
    onfinish: (provider: AssistantProvider, project?: Project) => void;
  } = $props();

  const PROVIDERS: AssistantProvider[] = ['claude', 'codex'];

  const STEPS: Record<Step, { label: string; title: string; text: string }> = {
    agents: {
      label: 'Agents',
      title: 'Connect your agents',
      text: 'Run Claude Code and Codex side by side on your repositories, right on your machine. Sign in to at least one to get started; you can add the other later in Settings.',
    },
    github: {
      label: 'GitHub',
      title: 'Connect GitHub',
      text: 'Pick from your repositories when adding projects, and push branches, open pull requests and merge them without leaving Bonfire.',
    },
    project: {
      label: 'Project',
      title: 'Add your first project',
      text: 'Clone a repository, or use one you already have. Agents work in the project folder, on whichever branch it has checked out.',
    },
  };

  // svelte-ignore state_referenced_locally
  const steps: Step[] = hasProjects
    ? ['agents']
    : ['agents', 'github', 'project'];
  const signedIn = $derived(
    PROVIDERS.filter((provider) => accounts[provider]?.signedIn),
  );
  // Signed in already but with no projects, as after removing the last one.
  // svelte-ignore state_referenced_locally
  let step = $state<Step>(
    !hasProjects && PROVIDERS.some((provider) => accounts[provider]?.signedIn)
      ? 'project'
      : 'agents',
  );
  let github = $state<GithubStatus>();
  /** The project step's clone, once it has one to offer. */
  let clone = $state<{ ready: boolean; cloning: boolean; name: string }>();
  /** Which way the steps moved, so the next one slides in from that side. */
  let direction = $state(1);

  const index = $derived(steps.indexOf(step));
  const githubSignedIn = $derived(!!(github?.installed && github.login));
  /** Whether GitHub is connected, once it is known. */
  const githubKnown = $derived(github && githubSignedIn);

  function done(item: Step) {
    if (item === 'agents') return signedIn.length > 0;
    if (item === 'github') return githubSignedIn;
    return false;
  }

  /** Steps can be revisited, and skipped ahead to once an agent is signed in. */
  function reachable(item: Step) {
    return item === 'agents' || signedIn.length > 0;
  }

  function go(next: Step) {
    if (!reachable(next) || next === step) return;
    direction = steps.indexOf(next) > index ? 1 : -1;
    step = next;
  }

  function next() {
    if (index === steps.length - 1) onfinish(signedIn[0]);
    else go(steps[index + 1]);
  }

  // The project step offers repositories once it knows GitHub is connected.
  onMount(() => {
    window.bonfire.github
      .status()
      .then((status) => (github ??= status))
      .catch(() => (github ??= { installed: false }));
  });

  function slide(node: Element) {
    return fly(node, {
      x: 16 * direction,
      duration: reducedMotion() ? 0 : 220,
      easing: cubicOut,
    });
  }
</script>

<div class="relative flex h-screen flex-col bg-background">
  <Backdrop />
  <div class="relative h-13 shrink-0 app-drag"></div>
  <div class="relative flex min-h-0 flex-1 overflow-y-auto px-6">
    <div
      class="mx-auto flex min-h-full w-full max-w-160 shrink-0 flex-col gap-10"
    >
      <header class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2.5">
          <Logo active class="size-8" />
          <span class="text-base font-semibold">Bonfire</span>
        </div>
        <ol class="flex items-center gap-10" aria-label="Setup steps">
          {#each steps as item, position (item)}
            {@const complete = done(item)}
            <li>
              <button
                type="button"
                class={cn(
                  'flex items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 enabled:hover:text-foreground disabled:cursor-default',
                  item === step && 'text-foreground',
                )}
                aria-current={item === step ? 'step' : undefined}
                disabled={!reachable(item)}
                onclick={() => go(item)}
              >
                <span
                  class={cn(
                    'grid size-5 shrink-0 place-content-center rounded-full bg-secondary text-xs tabular-nums',
                    complete && 'bg-green-600 text-white',
                  )}
                >
                  {#if complete}
                    <Icon name="check" class="size-3" />
                  {:else}
                    {position + 1}
                  {/if}
                </span>
                {STEPS[item].label}
              </button>
            </li>
          {/each}
        </ol>
      </header>

      <section class="relative my-auto flex min-w-0 flex-col overflow-hidden">
        {#key step}
          <div class="flex min-w-0 flex-col gap-6" in:slide aria-live="polite">
            <div class="flex flex-col gap-1.5">
              <h1 class="text-xl font-semibold text-balance">
                {STEPS[step].title}
              </h1>
              <p class="text-sm text-pretty text-muted-foreground">
                {STEPS[step].text}
              </p>
            </div>

            {#if step === 'agents'}
              <div class="flex flex-col gap-3">
                {#each PROVIDERS as provider (provider)}
                  <ProviderCard
                    {provider}
                    bind:account={accounts[provider]}
                    bind:error={accountErrors[provider]}
                  />
                {/each}
              </div>
            {:else if step === 'github'}
              <GithubCard bind:status={github} />
            {:else}
              <ProjectStep
                githubSignedIn={githubKnown}
                onconnectGithub={() => go('github')}
                oncreated={(project) => onfinish(signedIn[0], project)}
                bind:clone
              />
            {/if}
          </div>
        {/key}
      </section>

      <footer
        class="sticky bottom-0 flex items-center justify-between gap-4 pt-4 pb-8"
      >
        <span class="text-xs text-muted-foreground" role="status">
          {#if step === 'agents' && !signedIn.length}
            Sign in to one agent to continue
          {:else if step === 'project' && clone?.cloning && clone.name}
            Cloning {clone.name}; large repositories can take a minute
          {/if}
        </span>
        <div class="flex items-center gap-2">
          {#if index > 0}
            <Button
              variant="secondary"
              class="min-w-24"
              disabled={clone?.cloning}
              onclick={() => go(steps[index - 1])}
            >
              Back
            </Button>
          {/if}
          {#if step === 'project'}
            {#if clone}
              <Button
                type="submit"
                form={FORM_ID}
                class="min-w-24"
                disabled={!clone.ready}
                loading={clone.cloning}
              >
                Let’s go
              </Button>
            {/if}
          {:else if step === 'github' && !githubSignedIn}
            <Button variant="secondary" class="min-w-24" onclick={next}>
              Skip for now
            </Button>
          {:else}
            <Button
              class="min-w-24"
              disabled={step === 'agents' && !signedIn.length}
              onclick={next}
            >
              Continue
            </Button>
          {/if}
        </div>
      </footer>
    </div>
  </div>
</div>

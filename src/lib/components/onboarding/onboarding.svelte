<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
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
  let github = $state<GithubStatus>();
  /** The project section's clone, once it has one to offer. */
  let clone = $state<{ ready: boolean; cloning: boolean; name: string }>();
  let sections = $state<Partial<Record<Step, HTMLElement>>>({});

  const githubSignedIn = $derived(!!(github?.installed && github.login));
  /** Whether GitHub is connected, once it is known. */
  const githubKnown = $derived(github && githubSignedIn);

  function done(item: Step) {
    if (item === 'agents') return signedIn.length > 0;
    if (item === 'github') return githubSignedIn;
    return false;
  }

  /** Later sections wait until an agent is signed in. */
  function locked(item: Step) {
    return item !== 'agents' && signedIn.length === 0;
  }

  function scrollTo(item: Step, instant = false) {
    sections[item]?.scrollIntoView({
      block: 'start',
      behavior: instant || reducedMotion() ? 'instant' : 'smooth',
    });
  }

  // The project section offers repositories once it knows GitHub is connected.
  onMount(() => {
    // Signed in already but with no projects, as after removing the last one.
    if (!hasProjects && signedIn.length) scrollTo('project', true);
    window.bonfire.github
      .status()
      .then((status) => (github ??= status))
      .catch(() => (github ??= { installed: false }));
  });
</script>

<div class="relative flex h-screen flex-col bg-background">
  <Backdrop />
  <div class="relative h-13 shrink-0 app-drag"></div>
  <div {@attach overlayScrollbar} class="relative flex min-h-0 flex-1 overflow-y-auto px-6">
    <div
      class="mx-auto flex min-h-full w-full max-w-160 shrink-0 flex-col gap-16"
    >
      <header class="flex items-center gap-2.5">
        <Logo active class="size-5" />
        <span class="text-base font-semibold">Bonfire</span>
      </header>

      <ol class="flex flex-col" aria-label="Setup">
        {#each steps as item, position (item)}
          {@const complete = done(item)}
          {@const last = position === steps.length - 1}
          <li
            bind:this={sections[item]}
            class={cn(
              'flex scroll-mt-8 gap-4 transition-opacity duration-200',
              locked(item) && 'pointer-events-none opacity-40 select-none',
            )}
            inert={locked(item)}
          >
            <div class="flex shrink-0 flex-col items-center" aria-hidden="true">
              <span
                class={cn(
                  'mt-1 grid size-5 place-content-center rounded-full bg-secondary text-xs tabular-nums',
                  complete && 'bg-green-600 text-white',
                )}
              >
                {#if complete}
                  <Icon name="check" class="size-3" />
                {:else}
                  {position + 1}
                {/if}
              </span>
              {#if !last}
                <span
                  class="my-2 w-0 flex-1 border-l border-dashed border-border"
                ></span>
              {/if}
            </div>

            <div
              class={cn('flex min-w-0 flex-1 flex-col gap-6', !last && 'pb-16')}
            >
              <div class="flex flex-col gap-1.5">
                <h2 class="text-lg font-semibold text-balance">
                  {STEPS[item].title}
                </h2>
                <p class="text-sm text-pretty text-muted-foreground">
                  {STEPS[item].text}
                </p>
              </div>

              {#if item === 'agents'}
                <div class="flex flex-col gap-3">
                  {#each PROVIDERS as provider (provider)}
                    <ProviderCard
                      {provider}
                      bind:account={accounts[provider]}
                      bind:error={accountErrors[provider]}
                    />
                  {/each}
                </div>
              {:else if item === 'github'}
                <GithubCard bind:status={github} />
              {:else}
                <ProjectStep
                  githubSignedIn={githubKnown}
                  onconnectGithub={() => scrollTo('github')}
                  oncreated={(project) => onfinish(signedIn[0], project)}
                  bind:clone
                />
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      <footer class="flex items-center justify-between gap-4 pb-8">
        <span class="text-xs text-muted-foreground" role="status">
          {#if !signedIn.length}
            Sign in to one agent to continue
          {:else if clone?.cloning && clone.name}
            Cloning {clone.name}; large repositories can take a minute
          {/if}
        </span>
        {#if hasProjects}
          <Button
            class="min-w-24"
            disabled={!signedIn.length}
            onclick={() => onfinish(signedIn[0])}
          >
            Continue
          </Button>
        {:else}
          <Button
            type="submit"
            form={FORM_ID}
            class="min-w-24"
            disabled={!signedIn.length || !clone?.ready}
            loading={clone?.cloning}
          >
            Let’s go
          </Button>
        {/if}
      </footer>
    </div>
  </div>
</div>

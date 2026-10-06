<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import Logo from '$lib/components/logo/logo.svelte';
  import GithubCard from './github-card.svelte';
  import ProjectStep, { FORM_ID } from './project-step.svelte';
  import ProviderCard from './provider-card.svelte';
  import type {
    AssistantProvider,
    GithubStatus,
    Project,
    ProviderAccount,
  } from '$shared/contracts';
  import { cn } from '$lib/utils';
  import { overlayScrollbar } from '$lib/scrollbar';

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

  /** Each step's number badge, in order. */
  const BADGES = ['bg-amber-500', 'bg-orange-500', 'bg-rose-500'];

  const PROVIDERS: AssistantProvider[] = ['claude', 'codex'];

  const STEPS: Record<Step, { title: string; text: string }> = {
    agents: {
      title: 'Connect your agents',
      text: 'Run Claude Code and Codex side by side on your repositories, right on your machine. Sign in to at least one to get started.',
    },
    github: {
      title: 'Connect GitHub',
      text: 'Pick from your repositories when adding projects. Push branches and open pull requests without leaving Bonfire.',
    },
    project: {
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
  /** The project step's clone, once it has one to offer. */
  let clone = $state<{ ready: boolean; cloning: boolean; name: string }>();
  /** Set once the last step is done, while the app blooms in. */
  let finishing = $state(false);

  const githubSignedIn = $derived(!!(github?.installed && github.login));
  /** Whether GitHub is connected, once it is known. */
  const githubKnown = $derived(github && githubSignedIn);

  function done(item: Step) {
    if (item === 'agents') return signedIn.length > 0;
    if (item === 'github') return githubSignedIn;
    return false;
  }

  function finish(provider: AssistantProvider, project?: Project) {
    finishing = true;
    onfinish(provider, project);
  }

  onMount(() => {
    window.bonfire.github
      .status()
      .then((status) => (github ??= status))
      .catch(() => (github ??= { installed: false }));
  });
</script>

<div class="flex h-screen flex-col bg-background">
  <header class="flex h-13 shrink-0 items-center justify-center app-drag">
    <Logo active class="size-6" />
    <span class="sr-only">Bonfire setup</span>
  </header>

  <ol class="flex min-h-0 flex-1 gap-2 px-2 pb-2" aria-label="Setup">
    {#each steps as item, index (item)}
      {@const last = index === steps.length - 1}
      <li
        class={cn(
          'flex min-w-0 flex-1 basis-0 flex-col overflow-hidden rounded-lg bg-card p-6',
        )}
      >
        <span
          class={cn(
            'grid size-6 shrink-0 place-content-center rounded-full text-xs font-semibold text-white tabular-nums',
            BADGES[index],
          )}
          aria-hidden="true"
        >
          {index + 1}
        </span>

        <div
          {@attach overlayScrollbar}
          class="-mx-1.5 mt-12 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-1.5 pb-1.5"
        >
          <div class="flex flex-col gap-2">
            <h2 class="text-xl font-semibold text-balance">
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
              oncreated={(project) => finish(signedIn[0], project)}
              bind:clone
            />
          {/if}
        </div>

        <footer
          class="mt-6 flex min-h-9 shrink-0 items-center justify-between gap-4"
        >
          <span class="text-xs text-muted-foreground" role="status">
            {#if done(item)}
              <span
                class="flex items-center gap-1.5 text-sm font-medium text-success"
              >
                <Icon name="check" class="size-4" /> Completed
              </span>
            {:else if item === 'agents'}
              Sign in to one agent to continue
            {:else if item === 'github'}
              Optional; you can connect it later in Settings
            {:else if clone?.cloning && clone.name}
              Cloning {clone.name}; large repositories can take a minute
            {/if}
          </span>
          {#if item === 'project'}
            <Button
              type="submit"
              form={FORM_ID}
              class="min-w-24"
              disabled={!signedIn.length || !clone?.ready || finishing}
              loading={clone?.cloning}
            >
              Let’s go
              <Icon name="arrow-right" class="size-4" />
            </Button>
          {:else if last}
            <Button
              class="min-w-24"
              disabled={!signedIn.length || finishing}
              onclick={() => finish(signedIn[0])}
            >
              Let’s go
              <Icon name="arrow-right" class="size-4" />
            </Button>
          {/if}
        </footer>
      </li>
    {/each}
  </ol>
</div>

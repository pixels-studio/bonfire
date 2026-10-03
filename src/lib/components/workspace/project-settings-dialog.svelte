<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input, Textarea } from '$lib/components/ui/input';
  import Icon from '$lib/components/icon/icon.svelte';
  import OptionSelect from '../settings/option-select.svelte';
  import Setting from '../settings/setting.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Project, ProjectSettings } from '$shared/contracts';
  import { DEFAULT_FILES_TO_COPY, errorMessage } from '$shared/domain';

  type Override = 'default' | 'on' | 'off';

  let {
    open = $bindable(),
    project,
    onsaved,
  }: {
    open: boolean;
    project?: Project;
    onsaved: () => void;
  } = $props();

  let baseBranch = $state('');
  let setupScript = $state('');
  let archiveScript = $state('');
  let filesToCopy = $state('');
  let branchPrefix = $state('');
  let archiveOnMerge = $state<Override>('default');
  let deleteBranchOnArchive = $state<Override>('default');
  let saving = $state(false);
  let firstField = $state<HTMLInputElement | null>(null);

  const toOverride = (value?: boolean): Override =>
    value === undefined ? 'default' : value ? 'on' : 'off';
  const fromOverride = (value: Override) =>
    value === 'default' ? undefined : value === 'on';
  const overrideOptions = (fallback: boolean) => [
    {
      value: 'default' as const,
      label: `Default (${fallback ? 'On' : 'Off'})`,
    },
    { value: 'on' as const, label: 'On' },
    { value: 'off' as const, label: 'Off' },
  ];

  // Each time the dialog opens it starts from the saved settings.
  $effect(() => {
    if (!open || !project) return;
    const { settings } = untrack(() => project);
    baseBranch = settings.baseBranch ?? '';
    setupScript = settings.setupScript ?? '';
    archiveScript = settings.archiveScript ?? '';
    filesToCopy = settings.filesToCopy ?? '';
    branchPrefix = settings.branchPrefix ?? '';
    archiveOnMerge = toOverride(settings.archiveOnMerge);
    deleteBranchOnArchive = toOverride(settings.deleteBranchOnArchive);
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!project) return;
    const patch: Partial<ProjectSettings> = {
      baseBranch: baseBranch.trim(),
      setupScript,
      archiveScript,
      filesToCopy,
      branchPrefix: branchPrefix.trim() || undefined,
      archiveOnMerge: fromOverride(archiveOnMerge),
      deleteBranchOnArchive: fromOverride(deleteBranchOnArchive),
    };
    saving = true;
    try {
      await window.bonfire.projects.updateSettings(project.id, patch);
      open = false;
      onsaved();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="w-[min(36rem,calc(100vw-2rem))] gap-0 p-0"
    onOpenAutoFocus={(event) => {
      // The first focusable is an info icon, whose tooltip would open on its own.
      event.preventDefault();
      firstField?.focus();
    }}
  >
    <div class="flex shrink-0 items-center border-b border-border px-6 py-3">
      <Dialog.Title class="flex items-center gap-2 font-medium">
        <Icon name="settings" class="text-muted-foreground" />
        {project?.name} settings
      </Dialog.Title>
    </div>
    <form class="flex min-h-0 flex-col" onsubmit={save}>
      <div class="flex min-h-0 flex-col gap-6 overflow-y-auto p-6">
        <Setting
          title="Base branch"
          description="The branch new workspaces start from"
        >
          {#snippet control(props)}
            <Input
              {...props}
              bind:ref={firstField}
              bind:value={baseBranch}
              placeholder="Remote default branch, such as origin/main"
            />
          {/snippet}
        </Setting>
        <Setting
          title="Setup script"
          description="Runs in each new workspace, such as npm ci. Its output shows in the workspace terminal. BONFIRE_ROOT_PATH points to the project folder."
        >
          {#snippet control(props)}
            <Textarea
              {...props}
              bind:value={setupScript}
              rows={4}
              spellcheck={false}
              class="font-mono text-xs"
              placeholder="npm ci"
            />
          {/snippet}
        </Setting>
        <Setting
          title="Archive script"
          description="Runs in a workspace before it is archived, to clean up what lives outside its folder"
        >
          {#snippet control(props)}
            <Textarea
              {...props}
              bind:value={archiveScript}
              rows={3}
              spellcheck={false}
              class="font-mono text-xs"
            />
          {/snippet}
        </Setting>
        <Setting
          title="Files to copy"
          description="Ignored files copied from the project folder into new workspaces, one gitignore pattern per line. A .worktreeinclude file in the project takes precedence."
        >
          {#snippet control(props)}
            <Textarea
              {...props}
              bind:value={filesToCopy}
              rows={3}
              spellcheck={false}
              class="font-mono text-xs"
              placeholder={DEFAULT_FILES_TO_COPY}
            />
          {/snippet}
        </Setting>
        <Setting
          title="Branch prefix"
          description="Overrides the prefix from Settings for this project"
        >
          {#snippet control(props)}
            <Input
              {...props}
              bind:value={branchPrefix}
              placeholder={preferences.current.branchPrefix || 'No prefix'}
            />
          {/snippet}
        </Setting>
        <Setting
          title="Archive on merge"
          description="Archive a workspace when its branch's pull request merges"
        >
          {#snippet control(props)}
            <OptionSelect
              {...props}
              options={overrideOptions(preferences.current.archiveOnMerge)}
              value={archiveOnMerge}
              onchange={(value) => (archiveOnMerge = value)}
            />
          {/snippet}
        </Setting>
        <Setting
          title="Delete branch on archive"
          description="Delete a workspace's branch along with its folder"
        >
          {#snippet control(props)}
            <OptionSelect
              {...props}
              options={overrideOptions(
                preferences.current.deleteBranchOnArchive,
              )}
              value={deleteBranchOnArchive}
              onchange={(value) => (deleteBranchOnArchive = value)}
            />
          {/snippet}
        </Setting>
      </div>
      <div
        class="flex shrink-0 justify-end gap-2.5 border-t border-border px-6 py-3"
      >
        <Button
          type="button"
          variant="secondary"
          onclick={() => (open = false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>Save</Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

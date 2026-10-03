<script lang="ts">
  import { onMount } from 'svelte';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import { preferences } from '$lib/stores/preferences.svelte';
  import Setting from './setting.svelte';

  const current = $derived(preferences.current);
  /** Merges are looked up through gh, so archiving on merge needs it signed in. */
  let githubReady = $state(false);
  let branchPrefix = $state(preferences.current.branchPrefix);

  function saveBranchPrefix() {
    const next = branchPrefix.trim();
    if (next !== current.branchPrefix)
      void preferences.update({ branchPrefix: next });
  }

  onMount(() => {
    branchPrefix = current.branchPrefix;
    window.bonfire.github
      .status()
      .then((status) => (githubReady = status.installed && !!status.login))
      .catch(() => {});
  });
</script>

<Setting
  title="Branch prefix"
  description="Starts the name of every branch a new workspace gets. Projects can override it."
>
  {#snippet control(props)}
    <Input
      {...props}
      bind:value={branchPrefix}
      placeholder="No prefix"
      spellcheck={false}
      onblur={saveBranchPrefix}
      onkeydown={(event) => {
        if (event.key === 'Enter') saveBranchPrefix();
      }}
    />
  {/snippet}
</Setting>
<Setting
  title="Archive on merge"
  description={githubReady
    ? "Archive a workspace when its branch's pull request merges"
    : 'Sign in to GitHub below to archive workspaces when their pull request merges'}
  inline
>
  {#snippet control(props)}
    <Switch
      {...props}
      checked={githubReady && current.archiveOnMerge}
      disabled={!githubReady}
      onCheckedChange={(archiveOnMerge) =>
        preferences.update({ archiveOnMerge })}
    />
  {/snippet}
</Setting>
<Setting
  title="Delete branch on archive"
  description="Delete a workspace's branch along with its folder. A folder with uncommitted changes is always kept."
  inline
>
  {#snippet control(props)}
    <Switch
      {...props}
      checked={current.deleteBranchOnArchive}
      onCheckedChange={(deleteBranchOnArchive) =>
        preferences.update({ deleteBranchOnArchive })}
    />
  {/snippet}
</Setting>

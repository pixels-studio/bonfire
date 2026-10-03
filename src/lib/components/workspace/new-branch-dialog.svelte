<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import Icon from '$lib/components/icon/icon.svelte';
  import BaseBranchPicker from './base-branch-picker.svelte';
  import { branch } from '$lib/stores/branch.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';

  let {
    open = $bindable(),
    projectId,
  }: {
    open: boolean;
    projectId: string;
  } = $props();

  let name = $state('');
  let base = $state('');
  let creating = $state(false);

  // Each time the dialog opens it starts from what is checked out, so uncommitted work carries over cleanly.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = '';
      base = branch.head?.branch ?? 'HEAD';
    });
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !base || creating) return;
    creating = true;
    try {
      await branch.create(trimmed, base);
      open = false;
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      creating = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-[min(30rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-lg font-semibold">
        <Icon name="branch" class="text-muted-foreground" />
        New branch
      </Dialog.Title>
    </Dialog.Header>
    <form class="flex flex-col" onsubmit={create}>
      <Dialog.Body class="gap-8">
        <label class="flex flex-col gap-2">
          <span class="text-sm text-muted-foreground">Name</span>
          <Input
            bind:value={
              () => name,
              // Branch names can't hold spaces, so typing one gives a dash.
              (next) => (name = next.replace(/\s/g, '-'))
            }
            placeholder="fix-dropdown-height"
            spellcheck={false}
            autocomplete="off"
          />
        </label>
        <div class="flex flex-col gap-2">
          <span id="source-branch-label" class="text-sm text-muted-foreground">
            Source branch
          </span>
          <BaseBranchPicker
            {projectId}
            bind:value={base}
            aria-labelledby="source-branch-label"
          />
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button
          type="button"
          variant="secondary"
          class="min-w-20"
          onclick={() => (open = false)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          class="min-w-20"
          disabled={!name.trim() || !base}
          loading={creating}
        >
          Create
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

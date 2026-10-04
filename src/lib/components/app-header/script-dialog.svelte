<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input, Textarea } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { scripts } from '$lib/stores/scripts.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { RunScript, ScriptSuggestion } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let {
    open = $bindable(false),
    script,
    onsaved,
  }: {
    open: boolean;
    /** The script to edit; without one the dialog adds a new script. */
    script?: RunScript;
    /** Given the script once saved. */
    onsaved?: (script: RunScript) => void;
  } = $props();

  let name = $state('');
  let command = $state('');
  let saving = $state(false);
  let suggestions = $state<ScriptSuggestion[]>([]);

  /** Detected scripts not saved yet, which fill the form in one click. */
  const unsaved = $derived(
    suggestions.filter(
      (suggestion) =>
        !scripts.list?.some(({ command }) => command === suggestion.command),
    ),
  );

  // Each opening starts from the script being edited, or blank with fresh suggestions.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = script?.name ?? '';
      command = script?.command ?? '';
      suggestions = [];
      if (!script)
        void scripts.detect().then((found) => {
          if (open) suggestions = found;
        });
    });
  });

  function fill(suggestion: ScriptSuggestion) {
    name = suggestion.name;
    command = suggestion.command;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim() || !command.trim() || saving) return;
    saving = true;
    try {
      const saved = await scripts.save({
        id: script?.id,
        name: name.trim(),
        command: command.trim(),
      });
      open = false;
      if (saved) onsaved?.(saved);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      saving = false;
    }
  }

  /** ⌘/Ctrl+Enter saves from the command box, where Enter makes a new line. */
  function submitOnModEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-[min(32rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header class="flex-col items-start gap-1">
      <Dialog.Title class="text-lg font-semibold">
        {script ? 'Edit script' : 'Add script'}
      </Dialog.Title>
      <Dialog.Description class="text-muted-foreground">
        Runs in the project folder, in its own terminal pane.
      </Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col" onsubmit={save}>
      <Dialog.Body class="gap-6">
        {#if unsaved.length}
          <div class="flex flex-col gap-2">
            <Label>Found in this project</Label>
            <div class="flex flex-wrap gap-1.5">
              {#each unsaved as suggestion (suggestion.command)}
                <Button
                  size="xs"
                  variant={command === suggestion.command
                    ? 'default'
                    : 'secondary'}
                  title={suggestion.command}
                  onclick={() => fill(suggestion)}
                >
                  {suggestion.name}
                </Button>
              {/each}
            </div>
          </div>
        {/if}
        <label class="flex flex-col gap-2">
          <Label>Name</Label>
          <Input
            bind:value={name}
            placeholder="Website"
            maxlength={60}
            spellcheck={false}
            autocomplete="off"
          />
        </label>
        <label class="flex flex-col gap-2">
          <Label>Command</Label>
          <Textarea
            bind:value={command}
            class="min-h-24 resize-none font-mono text-xs"
            rows={4}
            placeholder="pnpm --filter web dev"
            spellcheck={false}
            autocomplete="off"
            onkeydown={submitOnModEnter}
          />
        </label>
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
          disabled={!name.trim() || !command.trim()}
          loading={saving}
        >
          Save
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

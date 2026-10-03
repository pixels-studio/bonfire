<script lang="ts">
  import { Textarea } from '$lib/components/ui/input';
  import { preferences } from '$lib/stores/preferences.svelte';
  import {
    ACTION_IDS,
    type ActionId,
    type Preferences,
  } from '$shared/contracts';
  import Setting from './setting.svelte';
  import { ACTION_LABELS, DEFAULT_ACTION_PROMPTS } from '$shared/domain';

  const DESCRIPTIONS: Record<ActionId, string> = {
    createPr: 'Instructions sent to the agent when you click Create PR.',
    push: 'Instructions sent to the agent when you click Push.',
    resolveConflicts:
      'Instructions sent to the agent when you click Resolve conflicts.',
    fixChecks: 'Instructions sent to the agent when you click Fix checks.',
  };

  const current = $derived(preferences.current);

  /** An empty box, or one matching the default, goes back to following the default. */
  function commit(action: ActionId, text: string) {
    const value = text.trim();
    const next: Preferences['actionPrompts'] = { ...current.actionPrompts };
    if (!value || value === DEFAULT_ACTION_PROMPTS[action]) delete next[action];
    else next[action] = value;
    if (next[action] === current.actionPrompts[action]) return;
    void preferences.update({ actionPrompts: next });
  }
</script>

<div class="flex flex-col gap-6">
  {#each ACTION_IDS as action (action)}
    <Setting title={ACTION_LABELS[action]} description={DESCRIPTIONS[action]}>
      {#snippet control(props)}
        <Textarea
          {...props}
          class="min-h-40 resize-y font-mono text-xs"
          rows={10}
          value={current.actionPrompts[action] ??
            DEFAULT_ACTION_PROMPTS[action]}
          onblur={(event) => commit(action, event.currentTarget.value)}
        />
      {/snippet}
    </Setting>
  {/each}
</div>

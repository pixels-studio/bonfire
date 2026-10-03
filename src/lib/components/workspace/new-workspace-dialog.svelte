<script lang="ts">
  import { untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import Composer from '../assistant-view/composer.svelte';
  import EffortPicker from '../assistant-view/effort-picker.svelte';
  import ModelSelect from '../assistant-view/model-select.svelte';
  import BaseBranchPicker from './base-branch-picker.svelte';
  import ProjectPicker from './project-picker.svelte';
  import { catalog } from '$lib/stores/models.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';
  import type { Project, ReasoningEffort, Session } from '$shared/contracts';

  let {
    open = $bindable(),
    projects,
    projectId: initialProjectId,
    model: initialModel,
    onaddproject,
    oncreated,
  }: {
    open: boolean;
    projects: Project[];
    /** The project the dialog starts on. */
    projectId?: string;
    /** The model the dialog starts on. */
    model: string;
    onaddproject: () => void;
    oncreated: (session: Session) => void;
  } = $props();

  let draftId = $state(crypto.randomUUID());
  let projectId = $state<string>();
  let base = $state('');
  let model = $state('');
  let effort = $state<ReasoningEffort>('medium');
  let creating = $state(false);
  /** Whether the draft became a workspace, which then owns its attachments. */
  let created = false;

  const project = $derived(projects.find(({ id }) => id === projectId));
  const provider = $derived(catalog.find(model)?.provider ?? 'claude');

  async function loadBase(id: string) {
    base = '';
    try {
      const next = await window.bonfire.projects.defaultBase(id);
      if (projectId === id) base = next;
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  function selectProject(id: string) {
    if (id === projectId) return;
    projectId = id;
    void loadBase(id);
  }

  /** Whether a draft is in progress, so closing knows to release it. */
  let drafting = false;

  // The dialog opens from its parent, so starting and ending a draft follows `open`.
  $effect(() => {
    const isOpen = open;
    untrack(() => {
      if (isOpen && !drafting) {
        drafting = true;
        catalog.load();
        draftId = crypto.randomUUID();
        created = false;
        model = initialModel || catalog.all[0]?.value || '';
        effort = 'medium';
        projectId = undefined;
        if (initialProjectId) selectProject(initialProjectId);
      } else if (!isOpen && drafting) {
        drafting = false;
        if (!created) void window.bonfire.workspaces.discardDraft(draftId);
      }
    });
  });

  async function create(text: string, attachmentIds: string[]) {
    if (!projectId || !base) return;
    creating = true;
    try {
      const session = await window.bonfire.workspaces.create({
        draftId,
        projectId,
        base,
        text,
        attachmentIds,
        provider,
        model,
        reasoningEffort: effort,
      });
      created = true;
      open = false;
      oncreated(session);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
      throw cause;
    } finally {
      creating = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="overflow-hidden bg-composer">
    <Dialog.Title class="sr-only">New workspace</Dialog.Title>
    <div
      class="flex items-center justify-between gap-6 border-b border-border px-4 py-3"
    >
      <ProjectPicker
        {projects}
        active={project}
        onselect={selectProject}
        onadd={onaddproject}
      />
      {#if creating}
        <p class="text-sm shimmer-text" role="status">Creating workspace</p>
      {:else if projectId}
        <BaseBranchPicker {projectId} bind:value={base} />
      {/if}
    </div>
    {#key draftId}
      <Composer
        label="Describe the task"
        placeholder="What do you want to work on?"
        attach={{
          pick: () => window.bonfire.workspaces.pickAttachment(draftId),
          text: (text) => window.bonfire.workspaces.attachText(draftId, text),
        }}
        allowEmpty
        submitLabel="Create workspace"
        textareaClass="min-h-32"
        autofocus
        disabled={!projectId || !base || creating}
        onsend={create}
      >
        <ModelSelect value={model} onchange={(next) => (model = next)} />
        <EffortPicker bind:value={effort} />
      </Composer>
    {/key}
  </Dialog.Content>
</Dialog.Root>

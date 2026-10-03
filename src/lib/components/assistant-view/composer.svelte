<script lang="ts" module>
  import type { Attachment } from '$shared/contracts';

  /** Where picked and pasted attachments are held until the message is sent. */
  export type AttachmentSource = {
    pick: () => Promise<Attachment | null>;
    text: (text: string) => Promise<Attachment>;
    file: (path: string) => Promise<Attachment>;
    image: (name: string, data: Uint8Array) => Promise<Attachment>;
  };
</script>

<script lang="ts">
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import X from '@lucide/svelte/icons/x';
  import { tick, type Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import SkillMenu, { matchSkills } from './skill-menu.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { matchShortcut } from '$lib/shortcuts';
  import { cn, isMac } from '$lib/utils';
  import {
    LONG_TEXT_THRESHOLD,
    attachmentMarker,
    errorMessage,
  } from '$shared/domain';
  import {
    MAX_SKILLS,
    MAX_TEXT_ATTACHMENT_LENGTH,
    type FollowUpMode,
    type Skill,
  } from '$shared/contracts';

  const MAX_ATTACHMENTS = 8;
  const FOLLOW_UP_ACTIONS: Record<FollowUpMode, string> = {
    queue: 'Queue message',
    steer: 'Steer response',
  };
  const FOLLOW_UP_PLACEHOLDERS: Record<FollowUpMode, string> = {
    queue: 'Queue a follow-up',
    steer: 'Steer the current run',
  };

  let {
    paneId = '',
    label,
    running = false,
    disabled = false,
    placeholder,
    attach = {
      pick: () => window.bonfire.assistant.pickAttachment(paneId),
      text: (text) => window.bonfire.assistant.attachText(paneId, text),
      file: (path) => window.bonfire.assistant.attachFile(paneId, path),
      image: (name, data) =>
        window.bonfire.assistant.attachImage(paneId, name, data),
    },
    allowEmpty = false,
    submitLabel = 'Send message',
    textareaClass,
    autofocus = false,
    onsend,
    children,
  }: {
    /** The pane the composer sends to; unset when it starts something new. */
    paneId?: string;
    label: string;
    running?: boolean;
    /** Blocks sending, e.g. until a project is chosen. */
    disabled?: boolean;
    placeholder?: string;
    attach?: AttachmentSource;
    /** Lets an empty message be sent, for a composer that starts something rather than chats. */
    allowEmpty?: boolean;
    submitLabel?: string;
    textareaClass?: string;
    autofocus?: boolean;
    /**
     * Sends the message with the names of its attached skills; `followUp` says how, when
     * a turn is already running. A rejection hands the draft back to the composer.
     */
    onsend: (
      text: string,
      attachmentIds: string[],
      skills: string[],
      followUp?: FollowUpMode,
    ) => Promise<void>;
    children: Snippet;
  } = $props();

  let prompt = $state('');
  let attachments = $state<Attachment[]>([]);
  /**
   * What each attachment looks like in the text, `[[name]]`, keyed by id. It is written at
   * the caret, shown as a chip, and swapped for the real marker when the message is sent.
   */
  let tokens = $state<Record<string, string>>({});
  /** Skills attached with `/`, which run with the message. */
  let skills = $state<Skill[]>([]);
  const canAttach = $derived(attachments.length < MAX_ATTACHMENTS);
  const followUp = $derived(preferences.current.followUp);
  const hasMessage = $derived(!!prompt.trim() || skills.length > 0);

  /** Sends the draft. While a turn runs, `invert` swaps queueing and steering for this message. */
  async function send(invert = false) {
    const text = withMarkers(prompt).trim();
    if ((!text && !skills.length && !allowEmpty) || disabled) return;
    const draft = { prompt, attachments, skills, tokens };
    prompt = '';
    attachments = [];
    skills = [];
    tokens = {};
    try {
      await onsend(
        text,
        draft.attachments.map(({ id }) => id),
        draft.skills.map(({ name }) => name),
        running ? followUpMode(invert) : undefined,
      );
    } catch {
      // Nothing typed is lost, unless the user has already started a new draft.
      if (!prompt && !attachments.length && !skills.length)
        ({ prompt, attachments, skills, tokens } = draft);
    }
  }

  // The `/` menu: typing `/` at the start of a word lists the provider's skills.
  const menuId = $props.id();
  /** Where the `/` being completed is, and what follows it; null while the menu is closed. */
  let slash = $state<{ start: number; query: string } | null>(null);
  /** The `/` whose menu Escape closed, so it stays closed until another `/` is typed. */
  let dismissed = -1;
  let highlighted = $state(0);
  let offered = $state<Skill[]>();
  let skillsError = $state('');
  const matches = $derived(
    slash ? matchSkills(offered ?? [], slash.query, skills) : [],
  );

  /** Opens, narrows, or closes the menu after the text or the caret moved. */
  function updateSlash() {
    if (!paneId || !textarea) return;
    const { value, selectionStart: caret, selectionEnd } = textarea;
    const typed =
      caret === selectionEnd
        ? /(?:^|\s)\/([^\s/]*)$/.exec(value.slice(0, caret))
        : null;
    if (!typed) {
      slash = null;
      dismissed = -1;
      return;
    }
    const query = typed[1];
    const start = caret - query.length - 1;
    if (start === dismissed) return;
    if (!slash) void loadSkills();
    if (slash?.start !== start || slash.query !== query) highlighted = 0;
    slash = { start, query };
  }

  /** Fetches the list each time the menu opens, so new skills show up; main caches it. */
  async function loadSkills() {
    skillsError = '';
    try {
      offered = await window.bonfire.assistant.skills(paneId);
    } catch (cause) {
      skillsError = errorMessage(cause);
    }
  }

  /** Attaches the skill and takes the `/` and what was typed after it out of the text. */
  async function chooseSkill(skill: Skill) {
    if (!slash || !textarea) return;
    if (skills.length >= MAX_SKILLS) {
      toast(`You can attach up to ${MAX_SKILLS} skills.`);
      return;
    }
    const before = prompt.slice(0, slash.start);
    const after = prompt.slice(textarea.selectionStart);
    prompt = before + (before.endsWith(' ') ? after.trimStart() : after);
    skills.push(skill);
    slash = null;
    await tick();
    textarea.setSelectionRange(before.length, before.length);
    textarea.focus();
  }

  function removeSkill(name: string) {
    skills = skills.filter((skill) => skill.name !== name);
  }

  /** Moves through and picks from the menu; returns whether the key was used. */
  function handleMenuKey(event: KeyboardEvent) {
    if (!slash) return false;
    const count = matches.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (!count) return false;
        highlighted =
          (highlighted + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
        return true;
      case 'Enter':
      case 'Tab':
        if (!count || event.shiftKey) return false;
        void chooseSkill(matches[Math.min(highlighted, count - 1)]);
        return true;
      case 'Escape':
        dismissed = slash.start;
        slash = null;
        return true;
    }
    return false;
  }

  function followUpMode(invert: boolean): FollowUpMode {
    if (!invert) return followUp;
    return followUp === 'queue' ? 'steer' : 'queue';
  }

  async function pickAttachment() {
    try {
      const attachment = await attach.pick();
      if (attachment) insertAttachment(attachment);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  /** Attaches dropped files, up to the limit. */
  export async function addFiles(files: File[]) {
    for (const file of files) {
      if (!canAttach) {
        toast(`You can attach up to ${MAX_ATTACHMENTS} files.`);
        return;
      }
      try {
        const path = window.bonfire.app.pathForFile(file);
        insertAttachment(
          path
            ? await attach.file(path)
            : await attach.image(
                file.name || 'Image',
                new Uint8Array(await file.arrayBuffer()),
              ),
        );
      } catch (cause) {
        toast(errorMessage(cause), { variant: 'error' });
      }
    }
  }

  const MAX_LINES = 10;
  let textarea = $state<HTMLTextAreaElement>();
  /** Grows the box with its content up to `MAX_LINES`, then lets it scroll. */
  function resize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const style = getComputedStyle(textarea);
    const line = parseFloat(style.lineHeight) || 20;
    const max = line * MAX_LINES;
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
    textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
  }
  $effect(() => {
    void prompt;
    resize();
  });

  /** Writes the attachment into the text where the caret is, so it is sent in place. */
  function insertAttachment(attachment: Attachment) {
    const base = `[[${
      attachment.name.length > 32
        ? `${attachment.name.slice(0, 31)}…`
        : attachment.name
    }]]`;
    const taken = new Set(Object.values(tokens));
    let token = base;
    for (let n = 2; taken.has(token); n++)
      token = `${base.slice(0, -2)} ${n}]]`;
    attachments.push(attachment);
    tokens[attachment.id] = token;
    const at = textarea?.selectionStart ?? prompt.length;
    const end = textarea?.selectionEnd ?? at;
    const before = prompt.slice(0, at);
    const after = prompt.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const tail = after.startsWith(' ') ? '' : ' ';
    prompt = `${before}${lead}${token}${tail}${after}`;
    const caret = before.length + lead.length + token.length + 1;
    void tick().then(() => {
      textarea?.setSelectionRange(caret, caret);
      textarea?.focus();
    });
  }

  /** The text with each attachment's chip swapped for the marker that is sent. */
  function withMarkers(text: string) {
    let result = text;
    for (const { id } of attachments)
      result = result.split(tokens[id]).join(attachmentMarker(id));
    return result;
  }

  // Deleting a chip's text takes the attachment out of the message.
  $effect(() => {
    const kept = attachments.filter(({ id }) => prompt.includes(tokens[id]));
    if (kept.length !== attachments.length) attachments = kept;
  });

  /** The text cut at its chips, so a layer behind the box can paint them. */
  const segments = $derived.by(() => {
    const list = attachments.map(({ id }) => tokens[id]).filter(Boolean);
    if (!list.length) return [{ text: prompt, chip: false }];
    const pattern = new RegExp(
      `(${list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    );
    return prompt
      .split(pattern)
      .map((text, index) => ({ text, chip: index % 2 === 1 }));
  });
  let highlights = $state<HTMLElement>();

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (handleMenuKey(event)) {
      event.preventDefault();
      // Escape here closes the menu, not the response the composer would otherwise stop.
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send(event.metaKey || event.ctrlKey);
  }

  /** Handles the shortcuts that work anywhere in the composer, not only in the text box. */
  function handleShortcut(event: KeyboardEvent) {
    if (event.isComposing) return;
    const shortcut = matchShortcut(event, isMac(), 'composer');
    if (shortcut === 'attach' && canAttach) {
      event.preventDefault();
      void pickAttachment();
    } else if (shortcut === 'stop' && running) {
      event.preventDefault();
      void window.bonfire.assistant.cancel(paneId);
    }
  }

  /** Turns a long paste into an attachment, so the message itself stays readable. */
  async function handlePaste(event: ClipboardEvent) {
    // Files and images copied from Finder, a browser or a screenshot tool.
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length) {
      event.preventDefault();
      await addFiles(files);
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (
      !preferences.current.convertLongText ||
      text.length <= LONG_TEXT_THRESHOLD
    )
      return;
    event.preventDefault();
    if (!canAttach) {
      toast(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    if (text.length > MAX_TEXT_ATTACHMENT_LENGTH) {
      toast('That text is too long to attach.', { variant: 'error' });
      return;
    }
    try {
      insertAttachment(await attach.text(text));
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }
</script>

<!-- The form only listens for keys bubbling up from the controls inside it. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
  class="relative rounded-lg bg-composer px-4 py-3"
  onkeydown={handleShortcut}
  onsubmit={(event) => {
    event.preventDefault();
    void send();
  }}
>
  {#if slash}
    <SkillMenu
      id={menuId}
      {matches}
      bind:highlighted
      loading={!offered}
      error={skillsError}
      onchoose={chooseSkill}
    />
  {/if}
  <div class="flex flex-wrap items-start gap-x-2 gap-y-1.5">
    {#each skills as skill (skill.name)}
      <div
        class="flex h-7 max-w-56 shrink-0 items-center gap-1 rounded-md bg-brand/15 py-1 pr-1 pl-2 text-xs font-medium text-brand"
        title={skill.description}
      >
        <span class="truncate">/{skill.name}</span>
        <button
          type="button"
          class="grid shrink-0 place-items-center rounded-full p-0.5 hover:bg-brand/20"
          aria-label={`Remove the ${skill.name} skill`}
          onclick={() => removeSkill(skill.name)}
        >
          <X class="size-3" />
        </button>
      </div>
    {/each}
    <div class="relative min-w-40 flex-1">
      <!-- Paints the chips behind the text; it has the box's exact font and wrapping. -->
      <div
        class="pointer-events-none absolute inset-0 overflow-hidden text-sm wrap-anywhere whitespace-pre-wrap text-transparent"
        aria-hidden="true"
        bind:this={highlights}
      >
        {#each segments as segment}{#if segment.chip}<mark
              class="rounded-md bg-brand/20 text-transparent"
              >{segment.text}</mark
            >{:else}{segment.text}{/if}{/each}
      </div>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        class={cn(
          'relative block min-h-15 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground',
          skills.length && 'min-h-7',
          textareaClass,
        )}
        aria-label={label}
        role={paneId ? 'combobox' : undefined}
        aria-autocomplete={paneId ? 'list' : undefined}
        aria-expanded={paneId ? !!slash : undefined}
        aria-controls={slash && matches.length ? menuId : undefined}
        aria-activedescendant={slash && matches.length
          ? `${menuId}-${highlighted}`
          : undefined}
        {autofocus}
        placeholder={placeholder ??
          (running
            ? FOLLOW_UP_PLACEHOLDERS[followUp]
            : paneId
              ? 'Ask for changes, or type / for skills'
              : 'Ask for changes')}
        bind:this={textarea}
        bind:value={prompt}
        oninput={updateSlash}
        onkeyup={(event) => {
          if (event.key.startsWith('Arrow') && !slash) updateSlash();
          else if (['Home', 'End'].includes(event.key)) updateSlash();
        }}
        onclick={updateSlash}
        onblur={() => (slash = null)}
        onkeydown={handleKeydown}
        onscroll={() => {
          if (highlights && textarea) highlights.scrollTop = textarea.scrollTop;
        }}
        onpaste={handlePaste}></textarea>
    </div>
  </div>
  <div class="flex items-center justify-between gap-3 pt-3">
    <div class="flex min-w-0 items-center gap-6">
      {@render children()}
    </div>
    <div class="flex items-center gap-2.5">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="secondary"
              size="icon"
              aria-label="Add attachment"
              disabled={!canAttach}
              onclick={pickAttachment}
            >
              <Icon name="attachment" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>
          Add attachment <ShortcutKeys id="attach" inverse />
        </Tooltip.Content>
      </Tooltip.Root>
      {#if running}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="secondary"
                size="icon"
                aria-label="Stop response"
                onclick={() => window.bonfire.assistant.cancel(paneId)}
              >
                <Icon name="stop" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>
            Stop response <ShortcutKeys id="stop" inverse />
          </Tooltip.Content>
        </Tooltip.Root>
      {/if}
      {#if !running || hasMessage}
        <Button
          type="submit"
          size="icon"
          class="bg-brand text-white hover:bg-brand/80"
          aria-label={running ? FOLLOW_UP_ACTIONS[followUp] : submitLabel}
          disabled={disabled || (!hasMessage && !allowEmpty)}
        >
          <ArrowUp />
        </Button>
      {/if}
    </div>
  </div>
</form>

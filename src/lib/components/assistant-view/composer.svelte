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
  import { overlayScrollbar } from '$lib/scrollbar';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { Editor, type JSONContent } from '@tiptap/core';
  import type { Node as PMNode } from '@tiptap/pm/model';
  import type { EditorView } from '@tiptap/pm/view';
  import { onMount, type Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import AudioBars from '$lib/components/icon/audio-bars.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import SkillMenu, { matchSkills } from './skill-menu.svelte';
  import DictationGlow from './dictation-glow.svelte';
  import { composerExtensions, plainTextSlice } from './composer-editor';
  import {
    dictationErrorMessage,
    startDictation as startDictationSession,
    type DictationSession,
  } from '$lib/dictation';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { matchShortcut } from '$lib/shortcuts';
  import {
    ATTACHMENT_NODE,
    SKILL_NODE,
    promptMarkdown,
  } from '$lib/prompt-markdown';
  import { cn, isMac } from '$lib/utils';
  import { LONG_TEXT_THRESHOLD, errorMessage } from '$shared/domain';
  import {
    MAX_SKILLS,
    MAX_TEXT_ATTACHMENT_LENGTH,
    type FollowUpMode,
    type Skill,
  } from '$shared/contracts';

  const MAX_ATTACHMENTS = 8;
  /** Stands for an attachment chip when reading the text before the caret. */
  const CHIP = '￼';
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
    end,
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
    /** Classes for the editable text box. */
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
    /** Rendered on the right, before the attach/dictate/send controls. */
    end?: Snippet;
  } = $props();

  let element = $state<HTMLDivElement>();
  let editor = $state.raw<Editor>();
  /**
   * The draft as it is sent: markdown, with each attachment chip written as its marker.
   * Kept in step with the editor, which is the source of truth.
   */
  let prompt = $state('');
  let attachments = $state<Attachment[]>([]);
  /** Skills picked with `/`, in the order they sit in the text; they run with the message. */
  let skills = $state<Skill[]>([]);
  let dictationSupported = $state(false);
  let dictationSession = $state<DictationSession | null>(null);
  let dictationStarting = $state(false);
  let dictationStatus = $state('');
  /** Bumped when a session starts or stops, so a stale one can't change the button. */
  let dictationRequestId = 0;
  /** Bumped when a session starts or the draft changes some other way; stale text is dropped. */
  let dictationWriteId = 0;
  /**
   * Where the dictated text sits in the draft, replaced whole as recognition revises it;
   * `prefix` is the space that separates it from the text before.
   */
  let dictationRange: { from: number; to: number; prefix: string } | null =
    null;
  /** Read by the glow's frame loop, not rendered as per-frame Svelte state. */
  let dictationLevel = 0;
  /** Set while dictated text is written, so that edit doesn't stop dictation. */
  let insertingDictation = false;
  const dictating = $derived(dictationStarting || !!dictationSession);
  const canAttach = $derived(attachments.length < MAX_ATTACHMENTS);
  const followUp = $derived(preferences.current.followUp);
  const hasMessage = $derived(!!prompt.trim() || skills.length > 0);
  const shownPlaceholder = $derived(
    placeholder ??
      (running
        ? FOLLOW_UP_PLACEHOLDERS[followUp]
        : paneId
          ? 'Ask for changes, or type / for skills'
          : 'Ask for changes'),
  );

  onMount(() => {
    const instance = new Editor({
      element,
      extensions: composerExtensions(() => shownPlaceholder),
      autofocus: autofocus ? 'end' : false,
      editorProps: {
        attributes: {
          class: cn(
            'composer-editor min-h-15 w-full text-sm caret-foreground outline-none wrap-anywhere',
            textareaClass,
          ),
        },
        handleKeyDown: handleKeydown,
        handlePaste,
        // Files dropped on the text are attached by the pane, like anywhere else on it.
        handleDrop: (_view, event) => !!event.dataTransfer?.files.length,
      },
      onUpdate: sync,
      onSelectionUpdate: updateSlash,
      onFocus: updateSlash,
      onBlur: () => (slash = null),
    });
    editor = instance;
    sync();
    return () => {
      stopDictation(false);
      dictationWriteId += 1;
      instance.destroy();
    };
  });

  onMount(() => {
    void window.bonfire.dictation
      .available()
      .then((available) => (dictationSupported = available))
      .catch(() => {});
  });

  // The placeholder is drawn by a decoration, which only redraws when the view updates.
  $effect(() => {
    void shownPlaceholder;
    if (editor && !editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  });

  // The editable box is what screen readers see, so it carries the field's semantics.
  $effect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const attributes: Record<string, string | undefined> = {
      'aria-label': label,
      'aria-multiline': 'true',
      role: paneId ? 'combobox' : 'textbox',
      'aria-autocomplete': paneId ? 'list' : undefined,
      'aria-expanded': paneId ? String(!!slash) : undefined,
      'aria-controls': slash && matches.length ? menuId : undefined,
      'aria-activedescendant':
        slash && matches.length ? `${menuId}-${highlighted}` : undefined,
    };
    for (const [name, value] of Object.entries(attributes))
      if (value === undefined) dom.removeAttribute(name);
      else dom.setAttribute(name, value);
  });

  /** The attachment ids the text still holds; deleting a chip takes its attachment out. */
  function placedIds(doc: PMNode) {
    const ids = new Set<string>();
    doc.descendants((node) => {
      if (node.type.name === ATTACHMENT_NODE) ids.add(node.attrs.id);
    });
    return ids;
  }

  /** The skills the text holds, in order; deleting one's `/name` takes it out. */
  function placedSkills(doc: PMNode) {
    const placed: Skill[] = [];
    doc.descendants((node) => {
      if (
        node.type.name === SKILL_NODE &&
        !placed.some(({ name }) => name === node.attrs.name)
      )
        placed.push({
          name: node.attrs.name,
          description: node.attrs.description,
        });
    });
    return placed;
  }

  function sync() {
    if (!editor) return;
    if (!insertingDictation) {
      dictationWriteId += 1;
      stopDictation(false);
    }
    prompt = promptMarkdown(editor.getJSON());
    const placed = placedSkills(editor.state.doc);
    if (
      placed.length !== skills.length ||
      placed.some(({ name }, index) => name !== skills[index].name)
    )
      skills = placed;
    const ids = placedIds(editor.state.doc);
    if (attachments.some(({ id }) => !ids.has(id)))
      attachments = attachments.filter(({ id }) => ids.has(id));
  }

  /** Sends the draft. While a turn runs, `invert` swaps queueing and steering for this message. */
  async function send(invert = false) {
    if (!editor) return;
    stopDictation(false);
    dictationWriteId += 1;
    sync();
    const text = prompt.trim();
    if ((!text && !skills.length && !allowEmpty) || disabled) return;
    const draft: {
      content: JSONContent;
      attachments: Attachment[];
      skills: Skill[];
    } = { content: editor.getJSON(), attachments, skills };
    attachments = [];
    editor.commands.clearContent(true);
    try {
      await onsend(
        text,
        draft.attachments.map(({ id }) => id),
        draft.skills.map(({ name }) => name),
        running ? followUpMode(invert) : undefined,
      );
    } catch {
      // Nothing typed is lost, unless the user has already started a new draft.
      if (editor.isEmpty && !prompt && !attachments.length && !skills.length) {
        // The attachments go back first, so restoring their chips doesn't drop them.
        attachments = draft.attachments;
        editor.commands.setContent(draft.content);
      }
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
    if (!paneId || !editor || !editor.view.hasFocus()) return;
    const { empty, $from: caret } = editor.state.selection;
    const before =
      empty && !caret.parent.type.spec.code
        ? caret.parent.textBetween(0, caret.parentOffset, undefined, (node) =>
            node.type.name === 'hardBreak' ? '\n' : CHIP,
          )
        : null;
    const typed = before === null ? null : /(?:^|\s)\/([^\s/￼]*)$/.exec(before);
    if (!typed) {
      slash = null;
      dismissed = -1;
      return;
    }
    const query = typed[1];
    const start = caret.pos - query.length - 1;
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

  /** Puts the skill in place of the `/` and what was typed after it, where the caret is. */
  function chooseSkill(skill: Skill) {
    if (!slash || !editor) return;
    if (skills.length >= MAX_SKILLS) {
      toast(`You can attach up to ${MAX_SKILLS} skills.`);
      return;
    }
    const { doc, selection } = editor.state;
    const { start } = slash;
    const caret = selection.from;
    const blockEnd = doc.resolve(start).end();
    const spaceAfter =
      caret < blockEnd && /\s/.test(doc.textBetween(caret, caret + 1));
    slash = null;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: start, to: caret }, [
        {
          type: SKILL_NODE,
          attrs: { name: skill.name, description: skill.description },
        },
        ...(spaceAfter ? [] : [{ type: 'text', text: ' ' }]),
      ])
      .run();
    // The caret goes past the space that follows, ready for the next word.
    if (spaceAfter) {
      const after = editor.state.selection.from + 1;
      editor.commands.setTextSelection(after);
    }
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
        chooseSkill(matches[Math.min(highlighted, count - 1)]);
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

  /** Puts an attachment already made elsewhere (e.g. a fork's summary) in the message box. */
  export function seed(attachment: Attachment) {
    insertAttachment(attachment);
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

  /** Puts the attachment's chip where the caret is, so it is sent in place. */
  function insertAttachment(attachment: Attachment) {
    if (!editor) return;
    attachments.push(attachment);
    const { doc, selection } = editor.state;
    const { from, to, $from: head, $to: tail } = selection;
    const before = from > head.start() ? doc.textBetween(from - 1, from) : '';
    const after = to < tail.end() ? doc.textBetween(to, to + 1) : '';
    const chip = {
      type: ATTACHMENT_NODE,
      attrs: {
        id: attachment.id,
        name: attachment.name,
        previewUrl: attachment.previewUrl ?? null,
      },
    };
    editor
      .chain()
      .focus()
      .insertContent([
        ...(before && !/\s/.test(before) ? [{ type: 'text', text: ' ' }] : []),
        chip,
        ...(after.startsWith(' ') ? [] : [{ type: 'text', text: ' ' }]),
      ])
      .run();
  }

  /**
   * Puts everything heard so far into the draft: at the caret the first time, then over
   * what was written before, since recognition revises earlier words as it goes.
   */
  function writeDictation(text: string) {
    if (!editor) return;
    let range = dictationRange;
    if (!range) {
      if (!text) return;
      const { from, to, $from: head } = editor.state.selection;
      const before =
        from > head.start() ? editor.state.doc.textBetween(from - 1, from) : '';
      range = { from, to, prefix: before && !/\s/.test(before) ? ' ' : '' };
    }
    const content = text ? range.prefix + text : '';
    insertingDictation = true;
    try {
      const chain = editor.chain().focus();
      (content
        ? chain.insertContentAt(
            { from: range.from, to: range.to },
            { type: 'text', text: content },
          )
        : chain.deleteRange({ from: range.from, to: range.to })
      ).run();
    } finally {
      insertingDictation = false;
    }
    dictationRange = { ...range, to: range.from + content.length };
  }

  function settleDictation(requestId: number, status: string) {
    if (requestId !== dictationRequestId) return;
    dictationRequestId += 1;
    dictationStarting = false;
    dictationSession = null;
    dictationLevel = 0;
    dictationStatus = status;
  }

  async function startDictation() {
    if (!dictationSupported || dictating || disabled) return;
    const requestId = ++dictationRequestId;
    const writeId = ++dictationWriteId;
    dictationRange = null;
    dictationStarting = true;
    dictationStatus = 'Listening';
    dictationLevel = 0;
    let failed = '';
    try {
      const session = await startDictationSession({
        api: window.bonfire.dictation,
        language: navigator.language,
        // Words still arriving after Stop are kept, unless the draft has moved on.
        onText: (text) => {
          if (writeId === dictationWriteId) writeDictation(text);
        },
        onLevel: (level) => {
          if (requestId === dictationRequestId) dictationLevel = level;
        },
        onError: (error) => (failed = dictationErrorMessage(error)),
        onEnd: () => {
          if (failed && requestId === dictationRequestId)
            toast(failed, { variant: 'error' });
          settleDictation(requestId, failed || 'Dictation stopped');
        },
      });
      if (requestId !== dictationRequestId) session.stop();
      else {
        dictationSession = session;
        dictationStarting = false;
      }
    } catch (error) {
      if (requestId === dictationRequestId)
        toast(dictationErrorMessage(error), { variant: 'error' });
      settleDictation(requestId, dictationErrorMessage(error));
    }
  }

  function stopDictation(restoreFocus = true) {
    if (!dictating) return;
    const session = dictationSession;
    dictationRequestId += 1;
    dictationStarting = false;
    dictationSession = null;
    dictationLevel = 0;
    dictationStatus = 'Dictation stopped';
    session?.stop();
    if (restoreFocus) editor?.commands.focus();
  }

  /**
   * Enter sends, and ⌘/Ctrl+Enter sends the other way while a turn runs. Shift+Enter
   * does what Enter does in a document: a new line, list item, or a step out of a list.
   */
  function handleKeydown(view: EditorView, event: KeyboardEvent) {
    if (event.isComposing || view.composing) return false;
    if (handleMenuKey(event)) {
      // Escape here closes the menu, not the response the composer would otherwise stop.
      event.stopPropagation();
      return true;
    }
    if (event.key !== 'Enter' || event.altKey) return false;
    if (event.shiftKey) {
      editor?.commands.first(({ commands }) => [
        () => commands.splitListItem('listItem'),
        () => commands.newlineInCode(),
        () => commands.createParagraphNear(),
        () => commands.liftEmptyBlock(),
        () => commands.splitBlock(),
      ]);
      return true;
    }
    void send(event.metaKey || event.ctrlKey);
    return true;
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

  /**
   * Attaches pasted files, and long text when that's turned on. Other text goes in as
   * typed, line for line, rather than as the HTML that came with it, so code copied from
   * an editor keeps its indentation and markdown stays the text it was. A paste from the
   * composer itself keeps its lists and formatting.
   */
  function handlePaste(view: EditorView, event: ClipboardEvent) {
    const data = event.clipboardData;
    if (!data) return false;
    // Files and images copied from Finder, a browser or a screenshot tool.
    const files = [...data.files];
    if (files.length) {
      void addFiles(files);
      return true;
    }
    const text = data.getData('text/plain');
    if (
      preferences.current.convertLongText &&
      text.length > LONG_TEXT_THRESHOLD
    ) {
      void attachText(text);
      return true;
    }
    if (!text || data.getData('text/html').includes('data-pm-slice'))
      return false;
    // ProseMirror pastes into a code block as plain text already.
    if (view.state.selection.$from.parent.type.spec.code) return false;
    view.dispatch(
      view.state.tr
        .replaceSelection(plainTextSlice(view.state.schema, text))
        .scrollIntoView(),
    );
    return true;
  }

  /** Turns a long paste into an attachment, so the message itself stays readable. */
  async function attachText(text: string) {
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
  {#if dictating}
    <DictationGlow getLevel={() => dictationLevel} />
  {/if}
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
  <!-- Grows with its content up to ten lines, then scrolls. -->
  <!-- overflow-y-auto also clips the x-axis per spec, so padding keeps a selected or
       hovered chip's outline from being cut off at the box's edge. -->
  <div
    {@attach overlayScrollbar}
    class="relative max-h-50 overflow-y-auto p-1 -m-1"
    bind:this={element}
  ></div>
  <p class="sr-only" aria-live="polite">{dictationStatus}</p>
  <div class="flex items-center justify-between gap-3 pt-3">
    <div class="flex min-w-0 items-center gap-6">
      {@render children()}
    </div>
    <div class="flex items-center gap-2.5">
      {@render end?.()}
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
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="secondary"
              size="icon"
              aria-label={dictating ? 'Stop dictation' : 'Dictate'}
              aria-pressed={dictating}
              class={dictating ? 'text-brand' : undefined}
              disabled={!dictating && (disabled || !dictationSupported)}
              onclick={dictating ? () => stopDictation() : startDictation}
            >
              {#if dictating}
                <Icon name="stop" />
              {:else}
                <AudioBars />
              {/if}
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>
          {dictating
            ? 'Stop dictation'
            : dictationSupported
              ? 'Dictate'
              : 'Dictation is unavailable in this browser'}
        </Tooltip.Content>
      </Tooltip.Root>
      <!-- One button: Stop while a turn runs with nothing typed; Send (queue/steer) once there's a draft. The stop shortcut still works either way. -->
      {#if running && !hasMessage}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="secondary"
                size="icon"
                class="bg-red-500 text-white hover:bg-red-500/90"
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
      {:else}
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

<style>
  /* The editor's content is rendered by ProseMirror, outside Svelte's scoping. */
  div :global(.composer-editor) {
    white-space: pre-wrap;
    line-height: 1.25rem;
  }
  div :global(.composer-editor > * + *) {
    margin-top: 0;
  }
  div :global(.composer-editor :is(ul, ol)) {
    margin: 0.125rem 0;
    padding-left: 1.375rem;
  }
  div :global(.composer-editor ul) {
    list-style: disc;
  }
  div :global(.composer-editor ul ul) {
    list-style: circle;
  }
  div :global(.composer-editor ol) {
    list-style: decimal;
  }
  div :global(.composer-editor li::marker) {
    color: var(--color-muted-foreground);
  }
  div :global(.composer-editor blockquote) {
    margin: 0.125rem 0;
    border-left: 2px solid var(--color-border);
    padding-left: 0.75rem;
    color: var(--color-muted-foreground);
  }
  div :global(.composer-editor :is(h1, h2, h3, h4, h5, h6)) {
    font-weight: 600;
  }
  div :global(.composer-editor h1) {
    font-size: 1.125rem;
    line-height: 1.75rem;
  }
  div :global(.composer-editor h2) {
    font-size: 1rem;
    line-height: 1.5rem;
  }
  div :global(.composer-editor code) {
    border-radius: 0.25rem;
    background: color-mix(in oklab, var(--color-muted) 70%, transparent);
    padding: 0.0625rem 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
  }
  div :global(.composer-editor pre) {
    margin: 0.25rem 0;
    border-radius: 0.375rem;
    background: color-mix(in oklab, var(--color-muted) 70%, transparent);
    padding: 0.5rem 0.75rem;
    overflow-x: auto;
    white-space: pre;
  }
  div :global(.composer-editor pre code) {
    background: none;
    padding: 0;
  }
  div :global(.composer-editor hr) {
    margin: 0.5rem 0;
    border-color: var(--color-border);
  }
  div :global(.composer-editor a) {
    color: var(--color-brand);
    text-decoration: underline;
  }
  div :global(.composer-editor .composer-attachment) {
    display: inline-block;
    margin: 0.0625rem 0;
    vertical-align: middle;
    line-height: 0;
  }
  div :global(.composer-editor .composer-attachment.ProseMirror-selectednode) {
    border-radius: 0.375rem;
    outline: 2px solid var(--color-brand);
  }
  div :global(.composer-editor .composer-skill) {
    color: var(--color-brand);
  }
  div :global(.composer-editor p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--color-muted-foreground);
    pointer-events: none;
  }
</style>

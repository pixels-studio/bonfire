import { Node, markInputRule, markPasteRule } from '@tiptap/core';
import Bold, {
  starInputRegex as boldInput,
  starPasteRegex as boldPaste,
} from '@tiptap/extension-bold';
import Italic, {
  starInputRegex as italicInput,
  starPasteRegex as italicPaste,
} from '@tiptap/extension-italic';
import { Placeholder } from '@tiptap/extensions';
import { Fragment, Slice, type Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { mount, unmount } from 'svelte';
import AttachmentChip from '$lib/components/conversation/attachment-chip.svelte';
import { ATTACHMENT_NODE } from '$lib/prompt-markdown';

/**
 * An attachment where it was put in the text, drawn as the same chip the conversation
 * shows. It has no HTML to parse back from, so a copied chip isn't pasted as a stray
 * marker for an attachment the message doesn't carry.
 */
const AttachmentNode = Node.create({
  name: ATTACHMENT_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: { default: '' },
      name: { default: '' },
      previewUrl: { default: null },
    };
  },

  renderHTML({ node }) {
    return ['span', { 'data-attachment': node.attrs.id }];
  },

  renderText({ node }) {
    return node.attrs.name;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      dom.className = 'composer-attachment';
      const chip = mount(AttachmentChip, {
        target: dom,
        props: {
          name: node.attrs.name,
          previewUrl: node.attrs.previewUrl ?? undefined,
        },
      });
      return {
        dom,
        // The chip never changes; a different attachment is a different node.
        update: (next) =>
          next.type === node.type && next.attrs.id === node.attrs.id,
        ignoreMutation: () => true,
        destroy: () => void unmount(chip),
      };
    };
  },
});

/**
 * The composer's formatting: lists, quotes, code and the usual marks, each of which has
 * a markdown form. Bold and italic only answer to `*`, so `__init__` or `snake_case_`
 * stays the text it was typed as. Underline has no markdown, and links only come from
 * pasted HTML, so a typed URL is sent untouched.
 */
export function composerExtensions(placeholder: () => string) {
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      underline: false,
      trailingNode: false,
      link: { autolink: false, linkOnPaste: false, openOnClick: false },
    }),
    Bold.extend({
      addInputRules() {
        return [markInputRule({ find: boldInput, type: this.type })];
      },
      addPasteRules() {
        return [markPasteRule({ find: boldPaste, type: this.type })];
      },
    }),
    Italic.extend({
      addInputRules() {
        return [markInputRule({ find: italicInput, type: this.type })];
      },
      addPasteRules() {
        return [markPasteRule({ find: italicPaste, type: this.type })];
      },
    }),
    Placeholder.configure({ placeholder }),
    AttachmentNode,
  ];
}

/**
 * Pasted plain text as one paragraph per line, blank lines included, so it is sent back
 * exactly as it was copied. (ProseMirror's own parser folds blank lines away.)
 */
export function plainTextSlice(schema: Schema, text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return new Slice(
    Fragment.from(
      lines.map((line) =>
        schema.nodes.paragraph.create(null, line ? schema.text(line) : null),
      ),
    ),
    1,
    1,
  );
}

import { attachmentMarker } from '../../shared/domain';

/** The parts of a Tiptap/ProseMirror JSON node the serializer reads. */
export type PromptNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PromptNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

/** The composer's attachment chip; it is sent as its marker. */
export const ATTACHMENT_NODE = 'attachment';

/** Marks in the order they nest, outermost first; code is innermost, since nothing parses inside it. */
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'];
const DELIMITERS: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
};

/**
 * The composer's document as the markdown the agent receives. Plain text is kept exactly
 * as typed, so a message without formatting reads the same as it did in a textarea: each
 * line is a paragraph, and paragraphs are joined by a single newline.
 */
export function promptMarkdown(doc: PromptNode): string {
  return blocks(doc.content ?? [], false)
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd();
}

/**
 * Blocks joined the way they were laid out. Consecutive paragraphs are lines; anything
 * else gets a blank line around it, unless it sits in a list item, where lines stay tight.
 */
function blocks(nodes: PromptNode[], tight: boolean): string {
  let out = '';
  nodes.forEach((node, index) => {
    if (index > 0) {
      const previous = nodes[index - 1];
      const lines =
        tight ||
        (previous.type === 'paragraph' && node.type === 'paragraph') ||
        isEmptyParagraph(previous);
      out += lines ? '\n' : '\n\n';
    }
    out += block(node);
  });
  return out;
}

function isEmptyParagraph(node: PromptNode) {
  return node.type === 'paragraph' && !node.content?.length;
}

function block(node: PromptNode): string {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content ?? []);
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `${'#'.repeat(level)} ${inline(node.content ?? [])}`;
    }
    case 'bulletList':
      return list(node, () => '- ');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return list(node, (index) => `${start + index}. `);
    }
    case 'blockquote':
      return blocks(node.content ?? [], false)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'codeBlock': {
      const code = textOf(node);
      const longest = Math.max(
        2,
        ...[...code.matchAll(/`+/g)].map(([run]) => run.length),
      );
      const fence = '`'.repeat(longest + 1);
      const language =
        typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '***';
    default:
      // Something pasted that the composer has no markdown for keeps its text.
      return node.content
        ? node.content.some((child) => child.type === 'text')
          ? inline(node.content)
          : blocks(node.content, false)
        : textOf(node);
  }
}

/** Each item behind its marker, with the item's later lines indented to line up under it. */
function list(node: PromptNode, marker: (index: number) => string) {
  return (node.content ?? [])
    .map((item, index) => {
      const head = marker(index);
      const indent = ' '.repeat(head.length);
      return blocks(item.content ?? [], true)
        .split('\n')
        .map((line, n) => (n === 0 ? head + line : line ? indent + line : ''))
        .join('\n');
    })
    .join('\n');
}

function textOf(node: PromptNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join('');
}

type Mark = { type: string; attrs?: Record<string, unknown> };

/**
 * Inline content with its marks as markdown delimiters. Marks stay open across nodes that
 * share them, and spaces are kept outside the delimiters, where markdown still sees them.
 */
function inline(nodes: PromptNode[]): string {
  let out = '';
  let open: Mark[] = [];
  /** Spaces that ended the last marked text, written once it is known whether marks close. */
  let pending = '';

  const close = (keep: number) => {
    while (open.length > keep) out += closer(open.pop()!);
  };

  for (const node of nodes) {
    const marks = sortMarks(
      (node.marks ?? []).filter((mark) => MARK_ORDER.includes(mark.type)),
    );
    let text: string;
    if (node.type === 'text') text = node.text ?? '';
    else if (node.type === 'hardBreak') text = '\n';
    else if (node.type === ATTACHMENT_NODE)
      text = attachmentMarker(String(node.attrs?.id ?? ''));
    else text = textOf(node);

    // How many of the open marks this node shares, from the outside in.
    let shared = 0;
    while (
      shared < open.length &&
      shared < marks.length &&
      sameMark(open[shared], marks[shared])
    )
      shared++;
    close(shared);
    out += pending;
    pending = '';

    let rest = text;
    if (marks.length > shared) {
      const lead = /^\s*/.exec(rest)![0];
      out += lead;
      rest = rest.slice(lead.length);
      if (!rest) continue;
      for (const mark of marks.slice(shared)) {
        out += opener(mark, rest);
        open.push(mark);
      }
    }
    if (open.length) {
      const trail = /\s*$/.exec(rest)![0];
      rest = rest.slice(0, rest.length - trail.length);
      pending = trail;
    }
    out += rest;
  }
  close(0);
  return out + pending;
}

function sortMarks(marks: Mark[]) {
  return [...marks].sort(
    (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
  );
}

function sameMark(a: Mark, b: Mark) {
  return a.type === b.type && (a.attrs?.href ?? '') === (b.attrs?.href ?? '');
}

/** Inline code needs a run of backticks longer than any inside it. */
const codeFences = new WeakMap<Mark, string>();

function opener(mark: Mark, text: string) {
  if (mark.type === 'link') return '[';
  if (mark.type === 'code') {
    const longest = Math.max(
      0,
      ...[...text.matchAll(/`+/g)].map(([run]) => run.length),
    );
    const fence = '`'.repeat(longest + 1);
    const code = text.trimEnd();
    codeFences.set(mark, code.endsWith('`') ? ` ${fence}` : fence);
    return code.startsWith('`') ? `${fence} ` : fence;
  }
  return DELIMITERS[mark.type] ?? '';
}

function closer(mark: Mark) {
  if (mark.type === 'link') return `](${String(mark.attrs?.href ?? '')})`;
  if (mark.type === 'code') return codeFences.get(mark) ?? '`';
  return DELIMITERS[mark.type] ?? '';
}

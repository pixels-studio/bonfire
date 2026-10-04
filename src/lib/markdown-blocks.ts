import { marked } from 'marked';

/**
 * How many trailing blocks are read again when text grows. New text can only reshape the
 * blocks it joins: the last one, or the one before it when that ends in blank lines (a
 * loose list taking another item, say). One more is read as a margin; it costs little.
 */
const REREAD_BLOCKS = 3;

function lex(text: string) {
  return marked.lexer(text, { gfm: true }).map((token) => token.raw);
}

/**
 * Splits markdown into the source of each top-level block. While a reply streams in, text
 * only grows at the end, so the blocks before the last few are kept and only the rest is
 * read again. Each update then costs the length of the last blocks, not the whole reply.
 */
export class MarkdownBlocks {
  private text = '';
  private sources: string[] = [];
  /** Whether the blocks add up to the text exactly, which reusing them depends on. */
  private exact = false;

  update(text: string): string[] {
    if (text === this.text) return this.sources;
    const keep = Math.max(0, this.sources.length - REREAD_BLOCKS);
    if (this.exact && keep && text.startsWith(this.text)) {
      const kept = this.sources.slice(0, keep);
      const offset = kept.reduce((length, source) => length + source.length, 0);
      this.sources = [...kept, ...lex(text.slice(offset))];
    } else {
      this.sources = lex(text);
      // The lexer normalizes line endings, after which offsets no longer line up.
      this.exact = this.sources.join('') === text;
    }
    this.text = text;
    return this.sources;
  }
}

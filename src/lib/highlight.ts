import type { HighlighterCore } from 'shiki';

export type Token = { content: string; color?: string };

const THEME = 'github-dark';
const MAX_LINES = 4000;
/** File extensions Shiki doesn't know by that name. */
const EXTENSIONS: Record<string, string> = {
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',
  yml: 'yaml',
  htm: 'html',
  zsh: 'shellscript',
  bash: 'shellscript',
  sh: 'shellscript',
  mdx: 'markdown',
  jsonc: 'jsonc',
  toml: 'toml',
};

let loading: Promise<{
  highlighter: HighlighterCore;
  languages: Record<string, unknown>;
}>;

function load() {
  loading ??= import('shiki').then(
    async ({
      createHighlighter,
      createJavaScriptRegexEngine,
      bundledLanguages,
    }) => ({
      // The WebAssembly engine would need a looser content security policy.
      highlighter: await createHighlighter({
        themes: [THEME],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }),
      languages: bundledLanguages,
    }),
  );
  return loading;
}

function languageOf(path: string) {
  const name = path.split('/').pop() ?? '';
  if (name === 'Dockerfile') return 'docker';
  const extension = name.includes('.')
    ? name.split('.').pop()!.toLowerCase()
    : '';
  return EXTENSIONS[extension] ?? extension;
}

/** Colored tokens for each of `lines`, or none when the language is unknown or the file is huge. */
export async function highlight(
  lines: string[],
  path: string,
): Promise<Token[][]> {
  if (!lines.length || lines.length > MAX_LINES) return [];
  const { highlighter, languages } = await load();
  const language = languageOf(path);
  if (!(language in languages)) return [];
  await highlighter.loadLanguage(
    languages[language] as Parameters<HighlighterCore['loadLanguage']>[0],
  );
  return highlighter.codeToTokens(lines.join('\n'), {
    lang: language,
    theme: THEME,
  }).tokens;
}

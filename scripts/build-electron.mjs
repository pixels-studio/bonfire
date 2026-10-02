import { build } from 'esbuild';
await build({
  entryPoints: ['electron/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/main/index.cjs',
  external: [
    'electron',
    'node-pty',
    '@openai/codex',
    '@anthropic-ai/claude-agent-sdk',
  ],
  sourcemap: true,
});
await build({
  entryPoints: ['electron/preload/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/preload/index.cjs',
  external: ['electron'],
});

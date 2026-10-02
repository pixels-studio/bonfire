import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

// Tests are TypeScript that imports app code without extensions, so they are bundled first.
const out = await mkdtemp(join(tmpdir(), 'bonfire-unit-'));
const tests = (await readdir('test')).filter((name) =>
  name.endsWith('.test.ts'),
);
await build({
  entryPoints: tests.map((name) => join('test', name)),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: out,
  external: [
    'electron',
    'node-pty',
    '@openai/codex',
    '@anthropic-ai/claude-agent-sdk',
  ],
  logLevel: 'warning',
});
const { status } = spawnSync(
  process.execPath,
  ['--test', ...tests.map((name) => join(out, name.replace(/\.ts$/, '.js')))],
  { stdio: 'inherit' },
);
await rm(out, { recursive: true, force: true });
process.exit(status ?? 1);

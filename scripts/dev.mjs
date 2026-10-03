import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import electron from 'electron';
await import('./build-electron.mjs');
// `--onboarding` starts from empty app data, so first-run setup shows on every launch.
const onboarding = process.argv.includes('--onboarding');
const data = onboarding
  ? await mkdtemp(join(tmpdir(), 'bonfire-onboarding-'))
  : undefined;
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BONFIRE_DEV_URL: server.resolvedUrls.local[0],
    ...(data && { BONFIRE_USER_DATA: data }),
  },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

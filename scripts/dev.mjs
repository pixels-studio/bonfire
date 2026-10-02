import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
await import('./build-electron.mjs');
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, BONFIRE_DEV_URL: server.resolvedUrls.local[0] },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

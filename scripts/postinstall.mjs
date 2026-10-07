// Rebuilds node-pty for Electron. Windows uses node-pty's bundled N-API prebuilds instead,
// so installing needs no Visual Studio toolchain (the source build requires Spectre libraries).
import { spawnSync } from 'node:child_process';

if (process.platform === 'win32') process.exit(0);

const run = spawnSync('npx', ['electron-rebuild', '-f', '-w', 'node-pty'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(run.status ?? 1);

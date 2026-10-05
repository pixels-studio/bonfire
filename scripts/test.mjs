import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';
const data = await mkdtemp(join(tmpdir(), 'bonfire-test-state-'));
// `BONFIRE_SMOKE_PHASES=hosts` runs only the checks every platform can run, as on Windows.
const phases = process.env.BONFIRE_SMOKE_PHASES?.split(',') ?? ['1', 'restart'];
for (const phase of phases) {
  const code = await new Promise((resolve) => {
    const child = spawn(electron, ['.'], {
      stdio: 'inherit',
      env: { ...process.env, BONFIRE_SMOKE: phase, BONFIRE_USER_DATA: data },
    });
    const timeout = setTimeout(() => {
      console.error('Smoke test timed out');
      child.kill('SIGKILL');
    }, 60000);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });
  if (code) process.exit(code);
}

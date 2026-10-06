// Starts the app on the demo's app data. `npm run dev:demo` seeds it first.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = process.env.BONFIRE_DEMO_DIR ?? join(homedir(), 'bonfire-demo');
spawn('node', ['scripts/dev.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, BONFIRE_USER_DATA: join(root, 'app-data') },
}).on('exit', (code) => process.exit(code ?? 0));

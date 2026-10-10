// Packages Bonfire for Windows from any OS: `npm run package:win` (add --arm64 for ARM, --with-agents to bundle the agent CLIs).
// Downloads the matching Electron build for Windows, puts the built app inside it, and zips the result.
// node-pty ships Windows prebuilds, so nothing needs compiling on this machine.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
const withAgents = process.argv.includes('--with-agents');
const name = `Bonfire-win32-${arch}`;
const out = join(root, 'release', name);
// On Windows npm is npm.cmd, which needs a shell, and Windows 10+ ships bsdtar that reads and writes zips.
const onWindows = process.platform === 'win32';
const shell = onWindows;
const tar = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'tar.exe',
);
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: 'inherit',
    cwd: root,
    shell,
    ...options,
  });

run('npm', ['run', 'build']);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8'),
).version;

// Fetch (or reuse the cached) Windows Electron zip.
const { downloadArtifact } = createRequire(
  join(root, 'node_modules/electron/'),
)('@electron/get');
const zip = await downloadArtifact({
  version: electronVersion,
  artifactName: 'electron',
  platform: 'win32',
  arch,
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (onWindows) run(tar, ['-xf', zip, '-C', out], { shell: false });
else run('unzip', ['-q', zip, '-d', out]);

const resources = join(out, 'resources');
const app = join(resources, 'app');
rmSync(join(resources, 'default_app.asar'), { force: true });
renameSync(join(out, 'electron.exe'), join(out, 'Bonfire.exe'));

// Windows takes the taskbar, Start menu and Settings icon from the exe, so replace Electron's.
// rcedit needs Wine off Windows, so other hosts keep Electron's icon.
if (onWindows) {
  const ico = join(root, 'release', 'icon.ico');
  mkdirSync(join(root, 'release'), { recursive: true });
  // VS Code terminals set ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  run('npx', ['electron', 'scripts/build-ico.cjs', ico], { env });
  const { rcedit } = await import('rcedit');
  await rcedit(join(out, 'Bonfire.exe'), {
    icon: ico,
    'version-string': {
      ProductName: 'Bonfire',
      FileDescription: 'Bonfire',
      InternalName: 'Bonfire',
      OriginalFilename: 'Bonfire.exe',
    },
    'product-version': pkg.version,
    'file-version': pkg.version,
  });
} else {
  console.warn("Not on Windows: Bonfire.exe keeps Electron's icon.");
}

mkdirSync(app, { recursive: true });
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      main: pkg.main,
      type: pkg.type,
      // The Codex package itself stays out of this build, but the app still needs to know
      // which version it expects, to tell the user when theirs is outdated.
      codexVersion: JSON.parse(
        readFileSync(
          join(root, 'node_modules/@openai/codex/package.json'),
          'utf8',
        ),
      ).version,
    },
    null,
    2,
  ),
);
for (const dir of ['dist', 'build', 'static'])
  cpSync(join(root, dir), join(app, dir), { recursive: true });

// Only what the main process loads at runtime: the production dependency tree. The agent CLIs are
// platform-specific and this machine only has its own; the app falls back to `claude` and `codex`
// installed on the Windows machine. (--with-agents is not supported here.)
if (withAgents) console.warn('--with-agents is ignored for Windows builds.');
const isAgentBinary = (path) =>
  /node_modules\/@(openai\/codex-|anthropic-ai\/claude-agent-sdk-)/.test(path);
const tree = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
  cwd: root,
  encoding: 'utf8',
  shell,
});
for (const path of tree
  .split('\n')
  .map((line) => line.trim().replace(/\\/g, '/'))
  .filter((line) => line.includes('/node_modules/'))) {
  if (isAgentBinary(path) || path.endsWith('/node_modules/@openai/codex'))
    continue;
  cpSync(path, join(app, relative(root, path)), {
    recursive: true,
    verbatimSymlinks: true,
  });
}

// node-pty ships prebuilds for every platform; keep Windows for this arch.
const prebuilds = join(app, 'node_modules/node-pty/prebuilds');
if (existsSync(prebuilds))
  for (const dir of readdirSync(prebuilds))
    if (dir !== `win32-${arch}`)
      rmSync(join(prebuilds, dir), { recursive: true, force: true });
// node-pty's compiled-from-source output is for the build machine.
rmSync(join(app, 'node_modules/node-pty/build'), {
  recursive: true,
  force: true,
});

// Unzipped, the app runs from wherever it is; the installer puts it in the user's programs and lists it.
const windows = join(root, 'scripts/windows');
for (const file of readdirSync(windows))
  writeFileSync(
    join(out, file),
    readFileSync(join(windows, file), 'utf8').replace(/\r?\n/g, '\r\n'),
  );

// Electron ships ~60 locale packs; keep English.
const locales = join(out, 'locales');
for (const file of readdirSync(locales))
  if (!file.startsWith('en-US')) rmSync(join(locales, file), { force: true });

mkdirSync(join(root, 'release'), { recursive: true });
const archive = join(root, 'release', `${name}.zip`);
rmSync(archive, { force: true });
if (onWindows)
  run(tar, ['-a', '-cf', archive, name], {
    cwd: join(root, 'release'),
    shell: false,
  });
else run('zip', ['-qr', archive, name], { cwd: join(root, 'release') });
console.log(`Packaged ${relative(root, out)} and ${relative(root, archive)}`);

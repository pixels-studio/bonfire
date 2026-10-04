// Packages Bonfire as a standalone macOS app: `npm run package` (add --install to copy it to /Applications).
// Reuses the installed Electron.app as the shell and puts the built app inside it, unpacked, so
// node-pty and the bundled agent CLIs stay ordinary files that can be executed.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'release', 'Bonfire.app');
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options });

run('npm', ['run', 'build']);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(root, 'release'), { recursive: true });
cpSync(join(root, 'node_modules/electron/dist/Electron.app'), out, { recursive: true, verbatimSymlinks: true });

const resources = join(out, 'Contents/Resources');
const app = join(resources, 'app');
rmSync(join(resources, 'default_app.asar'), { force: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
mkdirSync(app, { recursive: true });
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main, type: pkg.type }, null, 2),
);
for (const dir of ['dist', 'build', 'static']) cpSync(join(root, dir), join(app, dir), { recursive: true });

// The agent CLIs are ~520 MB. By default the app uses the `claude` and `codex` installed on the
// machine (both are already the fallback); pass --with-agents to bundle them instead.
const withAgents = process.argv.includes('--with-agents');
const isAgentBinary = (path) => /node_modules\/@(openai\/codex-|anthropic-ai\/claude-agent-sdk-)/.test(path);

// Only what the main process loads at runtime: the production dependency tree.
const tree = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8' });
for (const path of tree.split('\n').filter((line) => line.includes('/node_modules/'))) {
  if (!withAgents && (isAgentBinary(path) || path.endsWith('/node_modules/@openai/codex'))) continue;
  cpSync(path, join(app, relative(root, path)), { recursive: true, verbatimSymlinks: true });
}

// node-pty ships prebuilds for every platform; keep this machine's.
const prebuilds = join(app, 'node_modules/node-pty/prebuilds');
if (existsSync(prebuilds))
  for (const name of readdirSync(prebuilds))
    if (name !== `${process.platform}-${process.arch}`) rmSync(join(prebuilds, name), { recursive: true, force: true });

// Electron ships ~60 locale folders; keep English.
for (const name of readdirSync(resources))
  if (name.endsWith('.lproj') && !name.startsWith('en')) rmSync(join(resources, name), { recursive: true, force: true });

// Icon: static/icon.png -> icns.
const iconset = join(root, 'release', 'icon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  run('sips', ['-z', size, size, 'static/icon.png', '--out', join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
  run('sips', ['-z', size * 2, size * 2, 'static/icon.png', '--out', join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
}
run('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'bonfire.icns')]);
rmSync(iconset, { recursive: true, force: true });

const plist = join(out, 'Contents/Info.plist');
const set = (key, value) => run('plutil', ['-replace', key, '-string', value, plist]);
set('CFBundleName', 'Bonfire');
set('CFBundleDisplayName', 'Bonfire');
set('CFBundleIdentifier', 'dev.webuildproducts.bonfire');
set('CFBundleIconFile', 'bonfire.icns');
set('CFBundleShortVersionString', pkg.version);
set('CFBundleVersion', pkg.version);

// Electron's template asks for hardware the app never uses; without these keys macOS has no
// wording to show for a request, and the window denies every permission anyway.
for (const key of [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
])
  spawnSync('plutil', ['-remove', key, plist], { stdio: 'ignore' });
// Agents work in the projects opened here, which may sit in a protected folder.
const projectAccess =
  'Bonfire and the coding agents it runs read and edit the projects you open in it.';
for (const key of [
  'NSDesktopFolderUsageDescription',
  'NSDocumentsFolderUsageDescription',
  'NSDownloadsFolderUsageDescription',
  'NSRemovableVolumesUsageDescription',
  'NSNetworkVolumesUsageDescription',
])
  set(key, projectAccess);

// Renaming the executable would need every helper renamed too, so it keeps Electron's name.
// macOS remembers privacy answers per code signature. An ad-hoc one changes with every build,
// so each repackage asks again; a named identity (BONFIRE_SIGN_IDENTITY, such as a self-signed
// code signing certificate from Keychain Access) keeps the answers across builds.
const identity = process.env.BONFIRE_SIGN_IDENTITY || '-';
if (identity === '-')
  console.warn(
    'Signing ad hoc: macOS will ask for folder access again after this build. Set BONFIRE_SIGN_IDENTITY to keep it.',
  );
run('codesign', ['--force', '--deep', '--sign', identity, out], { stdio: 'ignore' });
console.log(`Packaged ${relative(root, out)}`);

if (process.argv.includes('--install')) {
  const target = '/Applications/Bonfire.app';
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  run('ditto', [out, target]);
  console.log(`Installed ${target}`);
}

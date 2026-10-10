import { build } from 'esbuild';
// Main, and the utility processes it moves work out to.
await build({
  entryPoints: {
    index: 'electron/main/index.ts',
    'terminal-host': 'electron/main/terminal-host.ts',
    'agent-host': 'electron/main/agent-host.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist/main',
  outExtension: { '.js': '.cjs' },
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

// On Windows, dictation is a PowerShell script on the system's speech recognizer; it ships as is.
if (process.platform === 'win32') {
  const { copyFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('dist/bin', { recursive: true });
  copyFileSync('native/dictation/windows.ps1', 'dist/bin/bonfire-dictation.ps1');
}

// Dictation runs on macOS's speech recognizer through a small native helper. Its Info.plist
// is embedded so macOS has wording for the microphone and speech recognition requests.
if (process.platform === 'darwin') {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync } = await import('node:fs');
  mkdirSync('dist/bin', { recursive: true });
  try {
    execFileSync(
      'swiftc',
      [
        '-O',
        'native/dictation/main.swift',
        '-o',
        'dist/bin/bonfire-dictation',
        ...[
          '-sectcreate',
          '__TEXT',
          '__info_plist',
          'native/dictation/Info.plist',
        ].flatMap((arg) => ['-Xlinker', arg]),
      ],
      { stdio: 'inherit' },
    );
  } catch {
    console.warn(
      'Could not build the dictation helper (is Xcode or its command line tools installed?); dictation will be unavailable.',
    );
  }
}

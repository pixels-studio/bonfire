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

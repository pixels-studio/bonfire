/** Environment variables scripts and terminals get for their workspace. */
export type WorkspaceEnvironment = Record<string, string>;

export function isWindows() {
  return process.platform === 'win32';
}

export function defaultShell() {
  return process.env.SHELL || (isWindows() ? 'powershell.exe' : '/bin/sh');
}

export function terminalEnvironment() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

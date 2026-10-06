import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { AssistantProvider, CliVersion } from '../../shared/contracts';
import { CLI_NAMES, errorMessage } from '../../shared/domain';
import { Cached } from './cached';
import type { Machine } from './machines';

/** How long a machine's version is trusted; the CLIs update themselves in the background. */
const VERSION_TTL_MS = 10 * 60_000;
/** Downloading a new build can take a while on a slow connection. */
const UPDATE_TIMEOUT_MS = 5 * 60_000;

/** Reads `2.1.287` from output such as `2.1.287 (Claude Code)` or `codex-cli 0.155.0`. */
export function parseVersion(output: string) {
  return /\d+\.\d+\.\d+/.exec(output)?.[0];
}

/** Negative when `a` is older than `b`, positive when newer, zero when equal. */
export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** A field of an installed package's package.json, read from beside its entry point. */
function packageField(entry: string, field: string): string | undefined {
  const value: unknown = JSON.parse(
    readFileSync(join(dirname(entry), 'package.json'), 'utf8'),
  )[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * The CLI version the app was built and tested against: the one the Claude SDK names, and
 * the Codex package the app ships. Unknown if that can't be read, and then nothing is called
 * outdated, as a check must never be what breaks the app.
 */
function requiredVersion(provider: AssistantProvider): string | undefined {
  try {
    const require = createRequire(__filename);
    return provider === 'claude'
      ? packageField(
          require.resolve('@anthropic-ai/claude-agent-sdk'),
          'claudeCodeVersion',
        )
      : packageField(require.resolve('@openai/codex/package.json'), 'version');
  } catch {
    return undefined;
  }
}

export type CliTarget = {
  provider: AssistantProvider;
  machine: Machine;
  /** What the user calls the machine, such as `This computer` or the connection's name. */
  name: string;
  /** How the CLI runs there: the app's bundled copy, or the one installed on the machine. */
  file: string;
  args: string[];
  env?: Record<string, string>;
};

/**
 * Compares the CLI each machine runs with the version the app expects. An older CLI may not
 * understand what the app asks of it, and the newest models refuse old clients with errors
 * that don't say so, such as Codex calling a model unsupported for ChatGPT accounts.
 */
export class CliVersions {
  private readonly required: Record<AssistantProvider, string | undefined> = {
    claude: requiredVersion('claude'),
    codex: requiredVersion('codex'),
  };
  private readonly checks = new Map<string, Cached<CliVersion>>();

  constructor(private readonly log: (message: string) => void) {}

  check(target: CliTarget): Promise<CliVersion> {
    const key = `${target.provider}:${target.machine.id}`;
    let check = this.checks.get(key);
    if (!check) {
      check = new Cached(() => this.read(target), VERSION_TTL_MS);
      this.checks.set(key, check);
    }
    return check.get();
  }

  /** Runs the CLI's own `update` on the machine, then reads the version it now has. */
  async update(target: CliTarget): Promise<CliVersion> {
    const cli = CLI_NAMES[target.provider];
    this.log(`Updating ${cli} on ${target.name}`);
    try {
      await target.machine.exec(target.file, [...target.args, 'update'], {
        env: target.env,
        timeout: UPDATE_TIMEOUT_MS,
      });
    } catch (cause) {
      const { stdout, stderr } = cause as { stdout?: string; stderr?: string };
      const detail = (stderr || stdout || errorMessage(cause)).trim();
      this.log(`${cli} update failed on ${target.name}: ${detail}`);
      throw Error(`Could not update ${cli} on ${target.name}: ${detail}`);
    }
    this.checks.get(`${target.provider}:${target.machine.id}`)?.clear();
    return this.check(target);
  }

  private async read(target: CliTarget): Promise<CliVersion> {
    const { provider, machine, name } = target;
    const output = await machine
      .exec(target.file, [...target.args, '--version'], {
        env: target.env,
        timeout: 15_000,
      })
      .catch(() => '');
    const installed = parseVersion(output);
    const required = this.required[provider];
    const outdated =
      !!installed && !!required && compareVersions(installed, required) < 0;
    this.log(
      `${CLI_NAMES[provider]} on ${name}: ${installed ?? 'not found'}, Bonfire expects ${required ?? 'an unknown version'}` +
        (outdated ? ' (outdated)' : ''),
    );
    return {
      provider,
      machineId: machine.id,
      machineName: name,
      installed,
      required,
      outdated,
    };
  }
}

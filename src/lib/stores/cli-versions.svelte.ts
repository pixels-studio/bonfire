import type { CliVersion } from '$shared/contracts';
import { CLI_NAMES, errorMessage } from '$shared/domain';
import { toast } from './toast.svelte';

/** Agent CLIs older than the app expects, per machine, and the update of them. */
class CliVersionsStore {
  outdated = $state<CliVersion[]>([]);
  updating = $state(false);

  /** Checks this computer and the open project's machine; the backend caches the answers. */
  async refresh() {
    if (!window.bonfire) return;
    try {
      const versions = await window.bonfire.providers.cliVersions();
      this.outdated = versions.filter(({ outdated }) => outdated);
    } catch (cause) {
      // A machine that can't be reached says so where it's used; the button just stays away.
      console.warn(`Could not check the agent CLIs: ${errorMessage(cause)}`);
    }
  }

  /** Updates every outdated CLI in turn, saying how each one went. */
  async update() {
    if (this.updating) return;
    this.updating = true;
    try {
      for (const { provider, machineId, machineName } of this.outdated) {
        const cli = CLI_NAMES[provider];
        try {
          const version = await window.bonfire.providers.updateCli(
            provider,
            machineId,
          );
          toast(
            version.outdated
              ? `${cli} on ${machineName} is at ${version.installed}, still older than the ${version.required} Bonfire needs.`
              : `${cli} on ${machineName} updated to ${version.installed}.`,
            { variant: version.outdated ? 'error' : 'info' },
          );
        } catch (cause) {
          toast(errorMessage(cause), { variant: 'error', duration: 0 });
        }
      }
      await this.refresh();
    } finally {
      this.updating = false;
    }
  }
}

export const cliVersions = new CliVersionsStore();

import type { SshConnection, SshConnectionInput } from '$shared/contracts';

/** The SSH connections projects can live on, shared by Settings and the project dialog. */
class ConnectionsStore {
  all = $state<SshConnection[]>([]);

  async load() {
    if (!window.bonfire) return;
    this.all = await window.bonfire.connections.list();
  }

  find(id?: string) {
    return this.all.find((connection) => connection.id === id);
  }

  async save(input: SshConnectionInput) {
    const saved = await window.bonfire.connections.save(input);
    await this.load();
    return saved;
  }

  async remove(id: string) {
    await window.bonfire.connections.remove(id);
    await this.load();
  }
}

export const connections = new ConnectionsStore();

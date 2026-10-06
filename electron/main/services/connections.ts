import { randomUUID } from 'node:crypto';
import type {
  ConnectionCheck,
  RemoteFolder,
  SshConnection,
  SshConnectionInput,
} from '../../../shared/contracts';
import { errorMessage } from '../../../shared/domain';
import { SshMachine, type Machines } from '../machines';
import type { Store } from '../persistence';

/** SSH connections, and browsing the folders of the machines they reach. */
export function connectionService({
  store,
  machines,
}: {
  store: Store;
  machines: Machines;
}) {
  /** Adds a connection, or updates the one with the input's id. */
  function save(input: SshConnectionInput) {
    const connection: SshConnection = {
      ...input,
      id: input.id ?? randomUUID(),
      port: input.port || undefined,
      identityFile:
        input.auth === 'identity' ? input.identityFile || undefined : undefined,
    };
    return store.connections.put(connection);
  }

  function remove(id: string) {
    const users = store.state.projects.filter(
      (project) => project.connectionId === id,
    );
    if (users.length)
      throw Error(
        `Remove the projects on this connection first: ${users.map(({ name }) => name).join(', ')}.`,
      );
    store.connections.remove(id);
  }

  async function check(input: SshConnectionInput): Promise<ConnectionCheck> {
    const machine = new SshMachine({ ...input, id: input.id ?? randomUUID() });
    try {
      return { ok: true, home: await machine.home() };
    } catch (cause) {
      return { ok: false, error: errorMessage(cause) };
    }
  }

  /** The folders in `path` on the connection's machine, hidden ones left out. */
  async function browse(
    connectionId: string,
    path?: string,
  ): Promise<RemoteFolder> {
    const machine = machines.get(connectionId);
    const folder = await machine.realpath(path || (await machine.home()));
    const items = await machine.readdir(folder);
    const parent = machine.path.dirname(folder);
    return {
      path: folder,
      parent: parent === folder ? undefined : parent,
      folders: items
        .filter((item) => item.directory && !item.name.startsWith('.'))
        .map((item) => item.name)
        .sort((first, second) => first.localeCompare(second)),
    };
  }

  return {
    list: () => [...store.state.connections],
    save,
    remove,
    check,
    browse,
  };
}

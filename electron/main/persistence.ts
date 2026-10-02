import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { stateSchema, type State } from '../../shared/contracts';
import { emptyState } from '../../shared/domain';

/** Atomically persisted application state; lookups throw when an id is unknown. */
export class Store {
  state: State;
  private readonly file: string;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'state.json');
    this.state = existsSync(this.file)
      ? stateSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
      : emptyState();
  }

  save() {
    const temporaryFile = `${this.file}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(this.state, null, 2), {
      mode: 0o600,
    });
    renameSync(temporaryFile, this.file);
  }

  project(id: string) {
    return find(this.state.projects, id, 'Project');
  }

  session(id: string) {
    return find(this.state.sessions, id, 'Session');
  }

  pane(id: string) {
    return find(this.state.panes, id, 'Pane');
  }
}

function find<Item extends { id: string }>(items: Item[], id: string, label: string) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw Error(`${label} not found`);
  return item;
}

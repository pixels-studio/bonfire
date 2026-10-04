# Bonfire

A local-first Electron workspace around the installed Claude Code and Codex CLIs.
Built with Svelte 5, SvelteKit, TypeScript, Tailwind, xterm.js, and node-pty. No AI APIs,
API keys, cloud services, or custom agent harness.

## Run

Requires Node 22.12+ (tested with Node 24), npm, system Git, and installed `claude` / `codex`
commands. Native builds require platform compiler tools (Xcode Command Line Tools on macOS).

```sh
npm ci
npm start
```

`npm start` builds the renderer, main process, and preload bundle before launching, so it
also works from a clean checkout. Development: `npm run dev`. Renderer changes hot reload;
restart after main/preload edits.
`npm run rebuild` repairs node-pty after changing Electron versions.

## Use

1. Pick a project and branch in the header. **Add project** takes a git repository on this
   computer, or on another machine over SSH (connections are managed in Settings). Help,
   Insights, and Settings live in the rail on the left.
2. Every pane works in the project folder itself, on whichever branch it has checked out.
   The branch menu lists local branches, newest first, and switches between them; uncommitted
   changes come along unless they would conflict, in which case git's message says why.
   **Branch** (⇧⌘B) creates a branch from the checked-out one or any other, fetching first
   when the base is a remote branch. Switching waits until no agent in the project is working.
   Git owns the current branch, so switches made by agents or terminals show up too.
3. Add Claude or Codex panes with **＋**; pick a model and thinking effort in the composer.
   Switching provider mid-chat opens a new pane. Panes use your existing CLI login.
4. The header's Files, Terminal, and Diff buttons open a panel for the project beside its panes.
   **Create PR** pushes the branch and opens a pull request against the remote default branch;
   after **Merge**, the toast offers to switch back to it and pull. With **Archive on merge**
   on (Settings › GitHub), conversations close once their branch's pull request merges.
5. Conversations, layout, and models persist. Quitting stops running turns and terminals.

Project removal removes Bonfire metadata and stops associated processes; project folders are
never modified or deleted.

## Architecture

- `src/lib/components/`: the strip's panes (`assistant-view`, `files-view`, `diff-view`, `terminal-view`, picked by `pane-view`), composer controls, and app chrome.
- `src/routes/`: application workspace.
- `shared/contracts.ts`: persisted models, typed API, runtime IPC schemas.
- `shared/domain.ts`: pure helpers shared by main and renderer (titles, labels, defaults).
- `electron/preload/`: narrow context-isolated bridge; no generic execution endpoint.
- `electron/main/`: persistence, Git, terminals, filesystem, Claude/Codex adapters
  (`assistant.ts` holds the shared turn lifecycle), and service composition.
- `scripts/`: builds, development runner, isolated Electron integration test.

Main is the authority for `projectId → folder`. Renderer terminal requests cannot
supply a command or working directory. Every IPC invocation validates its sender, frame,
and arguments. File paths resolve through realpath and cannot escape the project root.
Electron uses context isolation, renderer sandboxing, disabled Node integration, denied
new windows, denied permission requests, and a local-only application protocol.

State is atomically written to `state.json` in Electron's Bonfire user-data directory
(on macOS, `~/Library/Application Support/Bonfire`).
`BONFIRE_USER_DATA` can select a separate profile. Malformed state fails visibly rather than
silently replacing user data. No running process objects or credentials are persisted.

Filesystem browsing is lazy, nonrecursive, hides common build/dependency folders, and
filters Git-ignored entries where practical. Watching is bounded to three directory levels;
Git status also refreshes every five seconds. Text previews are limited to 2 MB. The diff
view is a basic unified diff, with index/worktree status codes; untracked files show text.

## Validation

```sh
npm run check
npm run build
npm test
```

`npm test` launches a real Electron window with an isolated temporary profile/repository.
It exercises concurrent shell PTYs, installed Claude/Codex CLI startup, Git status/diff,
text reads, traversal/symlink rejection, persistence across restart, and renderer/preload
isolation.
Screenshot: `artifacts/smoke.png`.
It does not send a model prompt or assert that the user's CLI account is authenticated.
No lint framework is configured. This is a source-run milestone, not a signed installer.

## Design reference

[Bonfire Figma frame](https://www.figma.com/design/R9cphQ7EfbVNRgY5uZAUU7/Editorial?node-id=291-2427).
Local icons are exact Figma exports. Sidebar grouping, dark panels, and branch chips follow
that frame; terminal content and changes come from real processes/files.

Electron isolation follows the [Electron context-isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation).

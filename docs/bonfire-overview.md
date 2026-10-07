# Bonfire: Project Overview

This document uses ASD-STE100 Simplified Technical English. Sentences are short. Each
sentence gives one item of information. Procedures use the imperative.

---

## 1. Description

Bonfire is a desktop application for macOS and Windows. It is an Electron application.

Bonfire is a workspace for coding agents. It operates the Claude Code CLI and the Codex
CLI that are installed on the computer. You can operate many agents at the same time, side
by side, in one window.

Bonfire is "local-first":

- It does not have its own AI service.
- It does not use API keys.
- It does not use a cloud service of its own.
- It uses the login that the CLIs already have.
- It keeps all data on the computer.

## 2. Purpose

A developer can give work to many agents at the same time. Bonfire shows all of this work
in one place. Bonfire also shows the project files, the changes, the terminals and the
pull request. Thus the developer does not have to change between many applications.

## 3. Main concepts

| Term | Meaning |
|---|---|
| Project | A Git repository folder. The folder is on this computer or on a remote computer (SSH). |
| Branch | The Git branch that is checked out in the project folder. All panes use this branch. |
| Pane | One work area in the strip. A pane is an agent, a terminal, the files, or the code diff. |
| Strip | The horizontal row of panes. You can scroll it, reorder it and resize its items. |
| Panel | An area in the strip opened from the header or rail. Activity shows the current project; Insights, Settings and Shortcuts are global. |
| Turn | One request to an agent and all of its reply. |
| Action | A prepared instruction that an agent does for you, for example "Create PR". |
| Run script | A command that starts the project, for example `npm run dev`. |

## 4. How to use Bonfire

1. Add a project. Select a folder on this computer, clone a GitHub repository, or select a
   folder on an SSH connection.
2. Select the branch in the header. Or make a new branch (⇧⌘B).
3. Add an agent pane with the "Add pane" button (＋) in the rail. Or push ⌘N.
4. Type a message in the composer. Send it.
5. Monitor the agent. Approve its tools if it asks.
6. Open Activity (⌘J), Files (⌘E) or Code diff (⌘D) from the header. Examine the
   project's recent work and changes.
7. Push "Run" to start the project.
8. Push "Create PR". An agent writes the pull request and opens it.
9. Push "Merge" when the pull request is ready.

## 5. Features

### 5.1 Agent panes (Claude and Codex)

**What it does.** An agent pane is a conversation with Claude Code or Codex. The agent can
read files, edit files and run commands in the project folder.

**How it works.**

- The agents run in the agent host, a utility process ("Bonfire Agents"). The main process
  does not parse their streams. See 6.1.
- Claude: the agent host uses the Claude Agent SDK (`query()`). The SDK starts the Claude
  Code CLI. The CLI uses the login of the user.
- Codex: the agent host starts one `codex app-server` process. It talks to the server
  with JSON-RPC on stdio. Each conversation is one "thread" on the server.
- Both adapters extend one base class, `ChatAssistant` (`electron/main/assistant.ts`). The
  base class controls the turn lifecycle: start, stream, approve, cancel and end.
- The Codex adapter converts Codex items into the same message model as Claude. Thus the
  user interface shows the two agents in the same way.
- The agent host collects stream updates for a short time. Then it sends them as one
  event. The main process adds them to its copy of the conversation and sends them to the
  window. This keeps the window fast.
- If the agent host stops, the main process starts it again on the next request. A turn
  that was running ends with an error message in its pane.

**Controls in the composer.**

- Model picker and thinking-effort slider.
- Skills menu. Type `/` to attach a skill.
- Attachments: images (pick, drop or paste) and long text. Pasted text that is longer than
  5,000 characters becomes an attachment.
- Voice dictation (macOS only). See 5.11.
- Context-usage gauge. It shows how much of the context window the conversation uses.
- Queued messages. A message that you send while the agent works waits in a queue. Or it
  "steers" the turn that runs now. A setting selects which.

**Approvals.** In "ask" mode, the agent asks before it uses a tool. You approve or refuse
the request in the pane. In "auto" mode, the application approves the tools.

**Capacity retry.** Sometimes the model is overloaded or rate-limited. Then the pane shows
a 20-second countdown and tries again.

**Titles.** A small model makes a short title from the first message.

**Fork to another agent.** You can fork a reply to the other agent. A model writes a
summary of the conversation. A new pane opens with the summary attached.

### 5.2 Terminal panes

**What it does.** A terminal pane is a shell in the project folder. You can open many.

**How it works.** The terminal host, a utility process ("Bonfire Terminals"), uses
`node-pty`. The shell is the shell of the user, so the PATH and version managers apply. The
terminal host collects output for a short time. Then it sends it to the window on a
`MessagePort` of its own, not through the main process. Typing, resizes and flow-control
acknowledgements come back on the same port. The renderer cannot supply a command or a
folder. The main process decides them, and starts and stops each terminal.

The window shows the output with `xterm.js`. Up to 15 terminals in view draw with WebGL
(`src/lib/webgl-pool.ts`). Chromium permits approximately 16 WebGL contexts in one page.
Other terminals, and all terminals when WebGL is not available, use the DOM renderer.

### 5.3 Files pane

**What it does.** It shows the file tree of the project. You can search files by name. You
can open a file to read it with syntax highlight.

**How it works.**

- The tree loads one folder at a time.
- It hides build folders, dependency folders and Git-ignored files.
- A file watcher sends change events. It watches all the folders of the project. It ignores
  changes in build folders and dependency folders. It reports a burst of changes one time.
- Text previews have a limit of 2 MB.
- All paths go through `safePath()`. A path cannot go out of the project folder, also not
  through a symbolic link.

**Limit.** A project can have only one Files pane. The header button opens it at the end of
the strip. A second push closes it.

### 5.4 Code diff pane ("Changes")

**What it does.** It shows the changed files of the branch, with added and removed lines.
You can open the diff of each file.

**How it works.** The main process runs `git diff` and `git status`. An untracked file
shows as a fully added file.

**Limit.** A project can have only one Code diff pane. The header button opens it at the
end of the strip. A second push closes it.

### 5.5 Strip and layout

- The strip holds up to 18 panes for each project.
- Each item has a size: full, half or one third. Without a selected size, the size comes
  from the number of items.
- You can drag an item by its grip. You can also move it with the arrow keys.
- New agent and terminal panes open at the start of the strip. Files and Code diff open at
  the end.
- The rail shows a minimap of the open panes. Each pane has a status dot (working, waiting
  for input, done).
- The application saves the layout. It opens again after a restart.

### 5.6 Branches

- The branch menu shows local branches. The most recent commit is first.
- When you change the branch, uncommitted changes go with it, if Git can do this.
- You cannot change the branch while an agent works.
- "New branch" makes a branch from a local branch or a remote branch. It fetches first for
  a remote base.
- Git owns the current branch. If an agent or a terminal changes it, Bonfire shows the
  change.

### 5.7 Pull requests and actions

**What it does.** The header shows one main button for the pull request. The button
changes with the state of the branch:

| State | Button |
|---|---|
| No pull request | Create PR |
| Changes not pushed | Push changes |
| Pull request has conflicts | Resolve conflicts |
| Checks fail | Fix checks |
| Ready | Merge |
| Merged | Merged |

**How it works.**

- Bonfire uses the GitHub CLI (`gh`) for all GitHub operations.
- An "action" opens a new agent pane. It sends the agent the instructions for the action.
  You can edit these instructions in Settings.
- "Merge" does a squash merge.
- The pull request pane shows the pull request after the panes.
- "Archive on merge" (optional): a watcher asks GitHub at intervals if the pull request is
  merged. If it is, the watcher closes the conversations of that branch.

### 5.8 Run scripts

**What it does.** The "Run" button starts the project. The menu lets you select, add and
edit scripts.

**How it works.**

- The first time, Bonfire finds scripts in the project files. It reads `package.json`, the
  lock file and the workspace files of monorepos.
- A script runs in its own terminal pane.
- "Run" again restarts the script. "Stop" sends Ctrl-C.

### 5.9 Panels

| Panel | What it shows |
|---|---|
| Activity | The pull requests of the repository and the commits pushed directly to the default branch. |
| Insights | Token use (today, 7 days, 30 days), with cost for each model. It also shows the plan limits of Claude and Codex. |
| Settings | Accounts, models, approvals, follow-up mode, accent color, notifications, SSH connections, GitHub, action instructions. |
| Shortcuts | The list of keyboard shortcuts. |

Insights reads the session logs of the Claude CLI and the Codex CLI on the computer. It
reads a file again only when the file changes.

### 5.10 Remote projects (SSH)

**What it does.** A project can be on another computer. You get to it with SSH.

**How it works.**

- Each folder is a "place": a machine and a path.
- For a remote machine, each command runs through `ssh`, in the login shell of the remote
  user.
- SSH connections are shared, so commands start quickly.
- Git, files, terminals and agents operate on the remote machine.
- File watching is not available for remote folders.

### 5.11 Voice dictation (macOS)

**What it does.** You speak. The text goes into the composer.

**How it works.** A small Swift helper (`native/dictation`) uses the speech recognizer of
macOS. It writes one JSON line for each event to stdout. The main process reads the lines
and sends them to the window. Only one composer can dictate at a time.

### 5.12 Other features

- **Notifications.** When the application is in the background, a system notification
  tells you that a turn finished, failed or needs input. A click on the notification shows
  the pane.
- **Completion sound.** Optional.
- **Keep awake.** Optional. The computer stays awake while a turn runs. This stops when
  the battery is low.
- **CLI version check.** Bonfire compares the installed CLIs with the version it expects.
  It can update an old CLI.
- **Onboarding.** The first screens help you sign in to an agent and add a project.
- **Accent color.** You can select the hue of the accent color.
- **Simplified English.** Optional. The agent writes its replies in ASD-STE100.
- **Recap.** On by default. When a task starts, the agent writes its understanding and its
  plan. After each turn that changes files, it writes a short title and summary. The Summary
  pane shows them as a timeline. Off, the agents are not asked, which saves a few tokens.

## 6. Architecture

### 6.1 Overview

```
┌──────────────────────────── Electron application ────────────────────────────┐
│                                                                               │
│  Renderer process (sandboxed)          Preload            Main process        │
│  ─────────────────────────────         ───────            ────────────        │
│  SvelteKit + Svelte 5 UI    ──invoke──▶ window.bonfire ──▶ IPC handlers       │
│  src/routes, src/lib        ◀──events── (typed bridge) ◀── services/          │
│        ▲                                                     │                │
│        │ MessagePort: terminal output and typing             ├─ Store (state) │
│        │                                                     ├─ agents ───────┼──▶ Agent host (utility process)
│        │                                                     │                │      ├─▶ Claude Code CLI (Agent SDK)
│        │                                                     │                │      └─▶ codex app-server (JSON-RPC)
│        └─────────────────────────────────────────────────────├─ terminals ────┼──▶ Terminal host (utility process)
│                                                              │                │      └─▶ node-pty shells
│                                                              ├─ git ──────────┼──▶ git
│                                                              ├─ github ───────┼──▶ gh
│                                                              ├─ filesystem    │
│                                                              ├─ machines ─────┼──▶ local / ssh
│                                                              └─ dictation ────┼──▶ Swift helper
└───────────────────────────────────────────────────────────────────────────────┘
```

The main process supervises two utility processes. It starts each on first use, starts it
again if it stops, and closes it when the application quits (`host-process.ts`).

- The **terminal host** (`terminal-host.ts`, `pty-host.ts`) runs every PTY and handles all
  terminal output. A crash ends its terminals only.
- The **agent host** (`agent-host.ts`, `agent-worker.ts`) runs the Claude and Codex
  adapters. It works on a copy of the state (`agent-store.ts`) that the main process sends
  after each change. It sends its changes back to the main process (`agent-client.ts`).
- The main process keeps the state and the saving, the IPC boundary, the windows,
  notifications and power control.

### 6.2 Layers

| Layer | Folder | Responsibility |
|---|---|---|
| Shared contracts | `shared/contracts.ts` | Data models, the typed API, and the Zod schemas for each IPC call. |
| Shared domain | `shared/domain.ts` | Pure functions and constants that both processes use. |
| Main process | `electron/main/` | All access to the system: files, Git, processes, network, storage. |
| Preload | `electron/preload/index.ts` | A small bridge. It makes `window.bonfire` from the list of requests. |
| Renderer | `src/` | The user interface. It has no direct access to the system. |
| Native helper | `native/dictation/` | macOS speech recognition. |
| Scripts | `scripts/` | Build, development runner, tests and packaging. |

### 6.3 Main process modules

| Module | Responsibility |
|---|---|
| `index.ts` | Starts the application. Makes the window. Registers the IPC handlers. Logs freezes. |
| `services/index.ts` | Joins all services. Implements each API call. |
| `services/projects.ts`, `panes.ts`, `connections.ts`, `pull-requests.ts`, `repository.ts`, `agents.ts` | One service for each area. |
| `persistence.ts` | Loads and saves the state. Migrates old state. |
| `state.ts` | All changes to the state: `store.projects`, `store.panes`, `store.connections`, `store.settings`. Other modules only read `store.state`. |
| `host-process.ts`, `rpc.ts` | Starts and supervises the utility processes, and the calls between processes. |
| `terminal-host.ts`, `pty-host.ts` | The terminal host. |
| `agent-host.ts`, `agent-worker.ts`, `agent-store.ts`, `agent-client.ts` | The agent host, and the main-process side of it. |
| `assistant.ts` | The base class for agents: turns, queue, steer, approvals, attachments. |
| `claude.ts` | The Claude adapter, on the Claude Agent SDK. |
| `codex.ts`, `codex-rpc.ts`, `codex-items.ts` | The Codex adapter, on `codex app-server`. |
| `terminal.ts`, `shell.ts` | The main-process side of the terminals: checks, commands, supervision. |
| `git.ts` | Git commands: status, diff, branches, checkout, pull. |
| `github.ts` | `gh` commands: sign-in, pull requests, merge, activity. |
| `merge-watcher.ts` | Finds merged pull requests and archives their conversations. |
| `filesystem.ts` | File list, read, search and watch, with safe paths. |
| `machines.ts` | Runs commands on this computer or over SSH. |
| `scripts.ts` | Finds and runs the run scripts. |
| `token-usage.ts`, `pricing.ts`, `limits.ts` | Data for the Insights panel. |
| `dictation.ts` | Controls the dictation helper. |
| `notifier.ts`, `keep-awake.ts`, `cli-version.ts` | Notifications, keep awake, CLI versions. |

### 6.4 Renderer structure

- `src/routes/+page.svelte` is the workspace. It holds the strip, the panes, the panels,
  the keyboard shortcuts and the layout.
- `src/lib/components/` holds the components. `pane-view` selects the view for each pane
  type: `assistant-view`, `terminal-view`, `files-view` or `diff-view`.
- `src/lib/stores/` holds shared state with Svelte 5 runes: branch, pull request, scripts,
  preferences, models, limits, tokens and toasts.
- The user interface uses Tailwind CSS and components in the style of shadcn.

### 6.5 Data flow for one turn

1. The user sends a message in the composer.
2. The renderer calls `window.bonfire.assistant.send()`.
3. The preload sends the call on IPC.
4. The main process checks the sender and the arguments with the Zod schema.
5. The main process sends the call to the agent host. The adapter (Claude or Codex) starts
   the turn on the CLI.
6. The CLI streams the reply. The adapter converts it into messages.
7. The agent host collects the updates and sends them to the main process. The main
   process adds them to the conversation and sends `assistantEvent` to the window.
8. The renderer shows the messages.
9. If the agent asks for approval, the renderer shows the request. The reply goes back
   with `assistant.respond()`.
10. At the end of the turn, the main process saves the conversation. It can also send a
    notification.

### 6.6 Storage

- The state is in `state.json`, in the user-data folder. On macOS, this is
  `~/Library/Application Support/Bonfire`.
- Each conversation is in its own file in `conversations/`. A save writes `state.json` and
  only the conversations that changed.
- Saves are delayed for a short time, so many changes cause one write.
- Each write is atomic: write to a temporary file, then rename.
- If the state is damaged, the application shows an error. It does not replace the data.
- The application does not save credentials or running processes.
- `BONFIRE_USER_DATA` selects a different data folder.

### 6.7 Security

- The window uses context isolation and a sandbox. Node integration is off.
- The application refuses new windows and permission requests.
- The application loads its pages from a local protocol (`bonfire://`).
- The preload gives only the typed API. It gives no general "run" function.
- Each IPC call checks its sender, its frame and its arguments.
- The main process owns the link from project to folder. The renderer sends only IDs.
- File paths cannot go out of the project folder.
- Bonfire never changes or deletes a project folder when you remove a project.

## 7. Technology

| Area | Technology |
|---|---|
| Shell | Electron |
| User interface | Svelte 5, SvelteKit (static adapter), TypeScript, Tailwind CSS |
| Terminal | xterm.js, node-pty |
| Agents | `@anthropic-ai/claude-agent-sdk`, `@openai/codex` |
| Validation | Zod |
| Build | Vite, esbuild |
| External tools | git, gh, ssh |

## 8. Build, test and package

| Command | Result |
|---|---|
| `npm run dev` | Starts the application in development mode. Renderer changes reload. |
| `npm start` | Builds everything and starts the application. |
| `npm run check` | Type checks the renderer and the main process. |
| `npm run test:unit` | Runs the unit tests in `test/`. |
| `npm test` | Starts a real Electron window with a temporary profile and repository. It tests terminals, CLIs, Git, files, persistence and SSH. |
| `npm run package` | Makes a macOS application. Add `--install` to copy it to `/Applications`. |
| `npm run package:win` | Makes a Windows package. |

### Requirements

- Node 22.12 or later.
- System Git.
- The `claude` and `codex` CLIs, installed and signed in.
- The GitHub CLI (`gh`) for pull request features.
- Xcode Command Line Tools (macOS) for native modules.

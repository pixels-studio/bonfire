import type {
  ActionId,
  AssistantEvent,
  PullRequestDraft,
  PullRequestInput,
} from '../../../shared/contracts';
import {
  ACTION_LABELS,
  actionPrompt,
  errorMessage,
} from '../../../shared/domain';
import * as git from '../git';
import type { GitHub } from '../github';
import type { Place } from '../machines';
import type { Store } from '../persistence';
import { actionAgentPrompt } from '../pull-request-text';
import type { Agents } from './agents';
import type { Panes } from './panes';
import type { Repository } from './repository';

type PullRequestOptions = {
  store: Store;
  github: GitHub;
  repository: Repository;
  panes: Panes;
  agents: Agents;
  /** Sends an event to the window alone. */
  toWindow: (event: AssistantEvent) => void;
};

/** The branch pull requests merge into: the remote's default branch. */
async function pullRequestBase(cwd: Place) {
  return (await git.defaultBranch(cwd)) ?? 'main';
}

/** Commits the branch has beyond its base, newest first. */
async function commitsBeyond(cwd: Place, base: string) {
  for (const ref of [`origin/${base}`, base])
    try {
      return await git.commitsAhead(cwd, ref);
    } catch {
      // The ref isn't known here; try the next.
    }
  return [];
}

/** A title from a branch name: `team/fix-dropdown-height` becomes "Fix dropdown height". */
function branchTitle(branch: string) {
  const words = (branch.split('/').pop() ?? '').replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Drafting, opening and acting on the pull request of a workspace's branch. */
export function pullRequestService({
  store,
  github,
  repository,
  panes,
  agents,
  toWindow,
}: PullRequestOptions) {
  async function draft(workspaceId: string): Promise<PullRequestDraft> {
    const cwd = repository.folder(workspaceId);
    // Independent lookups go at once; over SSH each is a round trip. The status is the one
    // the workspace's views share, as this runs whenever its files change.
    const [currentBranch, base, changes] = await Promise.all([
      git.currentBranch(cwd),
      // A task started from a chosen branch merges back into it.
      store.workspace(workspaceId).base ?? pullRequestBase(cwd),
      repository.status(workspaceId),
    ]);
    const branch = currentBranch ?? '';
    const [commits, unpushed] = await Promise.all([
      branch ? commitsBeyond(cwd, base) : [],
      branch ? git.unpushedCount(cwd) : 0,
    ]);
    const uncommitted = changes.changes.length;
    const single = commits.length === 1;
    const draft: PullRequestDraft = {
      branch,
      base,
      title: single ? commits[0] : branchTitle(branch),
      body: single
        ? await git.lastCommitBody(cwd)
        : commits
            .toReversed()
            .map((subject) => `- ${subject}`)
            .join('\n'),
      commits,
      uncommitted,
      unpushed,
    };
    if (!branch) draft.blocked = 'Check out a branch to open a pull request.';
    else if (branch === base)
      draft.blocked = `This is the ${base} branch. Create a branch from the branch menu to open a pull request.`;
    else if (!commits.length && !uncommitted)
      draft.blocked = `This branch has no changes beyond ${base} yet.`;
    return draft;
  }

  async function create(
    workspaceId: string,
    { title, body, commit }: PullRequestInput,
  ) {
    const cwd = repository.folder(workspaceId);
    const current = await draft(workspaceId);
    if (current.blocked) throw Error(current.blocked);
    if (commit && current.uncommitted) await git.commitAll(cwd, title);
    await git.pushBranch(cwd);
    return github.createPullRequest(cwd, { title, body, base: current.base });
  }

  /** Hands a pull request action to a new agent pane; resolves with the pane's id. */
  async function runAction(workspaceId: string, action: ActionId) {
    const current = await draft(workspaceId);
    if (action === 'push') {
      if (!current.branch) throw Error('Check out a branch to push.');
      if (!current.uncommitted && !current.unpushed)
        throw Error('There is nothing to push.');
    } else if (action === 'createPr' && current.blocked) {
      throw Error(current.blocked);
    }
    const pane = panes.add(
      undefined,
      store.workspace(workspaceId),
      false,
      'end',
    );
    // The turn runs on its own; its progress reaches the pane through events.
    void agents
      .send({
        paneId: pane.id,
        text: actionAgentPrompt(
          actionPrompt(store.preferences, action),
          current,
        ),
        attachmentIds: [],
        skills: [],
        model: pane.model,
        reasoningEffort: pane.reasoningEffort,
        fastMode: pane.fastMode,
        approvals: pane.approvals,
      })
      .catch((cause) => {
        console.warn(
          `Could not run ${ACTION_LABELS[action]}: ${errorMessage(cause)}`,
        );
        // No turn began, so nothing else would tell the header the action is over.
        toWindow({ paneId: pane.id, type: 'status', status: 'failed' });
      });
    return pane.id;
  }

  return {
    draft,
    create,
    runAction,
    open: async (
      workspaceId: string,
      openUrl: (url: string) => Promise<void>,
    ) => {
      const pull = await github.pullRequest(repository.folder(workspaceId));
      if (pull) await openUrl(pull.url);
    },
  };
}

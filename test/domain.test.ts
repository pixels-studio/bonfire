import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cloneUrl,
  editedPaths,
  errorMessage,
  reorderLayout,
  repositoryName,
  splitTaskSummary,
  summarySections,
  activitySteps,
  taskActivity,
  visibleReply,
} from '../shared/domain';
import type { ConversationMessage } from '../shared/contracts';
import { LANDMARKS, landmarkLabel, landmarkName } from '../shared/landmarks';
import { slug } from '../shared/domain';

test('reorderLayout keeps hidden panes in their slots', () => {
  assert.deepEqual(
    reorderLayout(['a', 'archived', 'b', 'terminal', 'c'], ['c', 'a', 'b']),
    ['c', 'archived', 'a', 'terminal', 'b'],
  );
});

test('reorderLayout rejects unknown or repeated panes', () => {
  assert.throws(() => reorderLayout(['a', 'b'], ['a', 'z']));
  assert.throws(() => reorderLayout(['a', 'b'], ['a', 'a']));
});

test('errors from main lose the IPC wrapping', () => {
  assert.equal(
    errorMessage(
      Error(
        "Error invoking remote method 'git.checkout': Error: No such branch",
      ),
    ),
    'No such branch',
  );
  assert.equal(errorMessage('plain'), 'plain');
});

test('cloneUrl accepts URLs, scp-style addresses and GitHub shorthand', () => {
  assert.equal(
    cloneUrl(' https://github.com/o/r.git '),
    'https://github.com/o/r.git',
  );
  assert.equal(cloneUrl('git@github.com:o/r.git'), 'git@github.com:o/r.git');
  assert.equal(cloneUrl('ssh://git@host/o/r'), 'ssh://git@host/o/r');
  assert.equal(cloneUrl('o/r'), 'https://github.com/o/r.git');
  assert.equal(cloneUrl('o/r.git'), 'https://github.com/o/r.git');
});

test('cloneUrl rejects what git would read as an option or command', () => {
  assert.equal(cloneUrl('--upload-pack=touch /tmp/x'), undefined);
  assert.equal(cloneUrl('ext::sh -c touch% /tmp/x'), undefined);
  assert.equal(cloneUrl('not a url'), undefined);
});

test('repositoryName is the last segment without .git', () => {
  assert.equal(repositoryName('https://github.com/o/repo.git'), 'repo');
  assert.equal(repositoryName('git@github.com:o/repo.git'), 'repo');
  assert.equal(repositoryName('git@host:repo.git'), 'repo');
  assert.equal(repositoryName('https://host/o/repo/'), 'repo');
});

function tool(
  name: string,
  input: string,
): Pick<ConversationMessage, 'kind' | 'tool'> {
  return { kind: 'tool', tool: { name, input, output: '' } };
}

test('editedPaths collects each file-editing tool call once, in order', () => {
  assert.deepEqual(
    editedPaths([
      tool('Read', '/a.ts'),
      tool('Edit', '/a.ts'),
      tool('Write', '/b.ts'),
      tool('Edit', '/a.ts'),
      tool('Bash', 'ls'),
      { kind: 'text', tool: undefined },
    ]),
    ['/a.ts', '/b.ts'],
  );
});

test('editedPaths splits a Codex fileChange covering several paths at once', () => {
  assert.deepEqual(editedPaths([tool('Edit', 'a.ts, b.ts')]), ['a.ts', 'b.ts']);
});

test('landmarks are valid folder and branch names, each once', () => {
  assert.equal(new Set(LANDMARKS).size, LANDMARKS.length);
  for (const name of LANDMARKS) assert.equal(slug(name), name);
  assert.equal(landmarkLabel('machu-picchu'), 'Machu Picchu');
});

test('a new workspace takes a free landmark, then numbered ones once all are taken', () => {
  const taken = new Set<string>(LANDMARKS.slice(1));
  assert.equal(landmarkName(taken), LANDMARKS[0]);
  taken.add(LANDMARKS[0]);
  assert.equal(
    landmarkName(taken, () => 0),
    `${LANDMARKS[0]}-2`,
  );
});

test('slugs are lowercase words joined by hyphens', () => {
  assert.equal(slug('  Abhi Ñandú!! '), 'abhi-nandu');
});

test('splitTaskSummary separates the summary block from the reply', () => {
  assert.deepEqual(
    splitTaskSummary(
      '<task-summary>\n**Understanding**\n- A.\n</task-summary>\n\nI will start.',
    ),
    { summary: '**Understanding**\n- A.', reply: 'I will start.' },
  );
});

test('splitTaskSummary treats a block still being written as a summary', () => {
  assert.deepEqual(splitTaskSummary('<task-summary>\n**Understanding**\n- A'), {
    summary: '**Understanding**\n- A',
    reply: '',
  });
});

test('splitTaskSummary leaves a reply with no block whole', () => {
  assert.deepEqual(splitTaskSummary('Done.'), { reply: 'Done.' });
});

test('taskActivity reads the title and summary tags', () => {
  assert.deepEqual(
    taskActivity(
      'Done.\n\n<task-activity>\n<title>Shared Model</title>\n<summary>The change adds a model.</summary>\n</task-activity>',
    ),
    { title: 'Shared Model', body: 'The change adds a model.' },
  );
  assert.equal(taskActivity('Done.'), undefined);
});

test('taskActivity reads an older block by its lines', () => {
  assert.deepEqual(
    taskActivity(
      '<task-activity>\n**Shared Model**\nThe change adds a model.\n</task-activity>',
    ),
    { title: 'Shared Model', body: 'The change adds a model.' },
  );
});

test('visibleReply hides the summary and activity blocks', () => {
  assert.equal(
    visibleReply(
      '<task-summary>\nA\n</task-summary>\nStarted.\n<task-activity>\nT\nB\n</task-activity>',
    ),
    'Started.',
  );
});

test('activitySteps keeps finished turns that changed files', () => {
  const message = (
    id: string,
    role: 'user' | 'assistant',
    kind: ConversationMessage['kind'],
    text = '',
    extra: Partial<ConversationMessage> = {},
  ): ConversationMessage => ({
    id,
    role,
    kind,
    text,
    status: 'complete',
    ...extra,
  });
  const messages = [
    message('u1', 'user', 'text', 'Add the model'),
    message('t1', 'assistant', 'tool', '', {
      tool: { name: 'Write', input: '/repo/a.ts', output: '' },
    }),
    message(
      'r1',
      'assistant',
      'text',
      '<task-activity>\nModel\nAdded it.\n</task-activity>',
      {
        createdAt: 5,
      },
    ),
    message('u2', 'user', 'text', 'What does it do?'),
    message('r2', 'assistant', 'text', 'It models.', { createdAt: 9 }),
    message('u3', 'user', 'text', 'Now test it'),
    message('t3', 'assistant', 'tool', '', {
      tool: { name: 'Edit', input: '/repo/a.test.ts', output: '' },
    }),
  ];
  // The last turn is still running, so it waits until it ends.
  const steps = activitySteps(messages, true);
  assert.deepEqual(
    steps.map(({ id, paths, activity, startedAt }) => ({
      id,
      paths,
      activity,
      startedAt,
    })),
    [
      {
        id: 'u1',
        paths: ['/repo/a.ts'],
        activity: { title: 'Model', body: 'Added it.' },
        startedAt: 5,
      },
    ],
  );
  assert.deepEqual(
    activitySteps(messages, false).map(({ id }) => id),
    ['u1', 'u3'],
  );
});

test('summarySections reads the part tags in order, leaving out empty ones', () => {
  assert.deepEqual(
    summarySections(
      '<plan>\n1. B.\n</plan>\n<understanding>\n- A.\n</understanding>\n<needs>\n</needs>',
    ),
    [
      { heading: 'understanding', body: '- A.' },
      { heading: 'plan', body: '1. B.' },
    ],
  );
});

test('summarySections cuts an older summary at its bold headings', () => {
  assert.deepEqual(
    summarySections(
      '**Understanding**\n- A.\n\n**Plan**\n1. B.\n\n**Needs**\n',
    ),
    [
      { heading: 'Understanding', body: '- A.' },
      { heading: 'Plan', body: '1. B.' },
    ],
  );
  assert.deepEqual(summarySections('Just text.'), [
    { heading: undefined, body: 'Just text.' },
  ]);
});

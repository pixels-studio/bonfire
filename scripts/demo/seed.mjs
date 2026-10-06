/**
 * Builds a demo of Bonfire to design against: two real Git repositories, worktrees in every
 * workspace state, conversations that match the work in each worktree, and an app-data folder
 * that points at all of it.
 *
 *   node scripts/demo/seed.mjs            # rebuilds ~/bonfire-demo
 *   BONFIRE_DEMO_DIR=/tmp/demo node …     # somewhere else
 *
 * Start the app on it with `npm run dev:demo`. Rebuilding deletes the folder first, so
 * run it whenever the demo has drifted from this script.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chats from './conversations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT =
  process.env.BONFIRE_DEMO_DIR ?? join(homedir(), 'bonfire-demo');
const DATA = join(ROOT, 'app-data');
const WORKTREES = join(ROOT, 'worktrees');
const NOW = Date.now();
const DAY = 86_400_000;

const MAYA = { name: 'Maya Lindqvist', email: 'maya@tidewater.coffee' };
const ABHI = { name: 'Abhi Rao', email: 'abhi@webuildproducts.dev' };

// --- Git helpers -----------------------------------------------------------------------------

function git(cwd, args, author = ABHI, daysAgo = 0) {
  const date = new Date(NOW - daysAgo * DAY).toISOString();
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  }).trim();
}

function commit(cwd, message, author, daysAgo) {
  git(cwd, ['add', '-A'], author, daysAgo);
  git(cwd, ['commit', '-q', '-m', message], author, daysAgo);
}

/** Copies a folder of new files over a worktree. */
function overlay(name, repo, cwd) {
  cpSync(join(here, 'repos', repo, name), cwd, { recursive: true });
}

/** Replaces text in a file, and fails loudly if it isn't there, so drift in a base file shows. */
function edit(cwd, file, from, to) {
  const path = join(cwd, file);
  const before = readFileSync(path, 'utf8');
  if (!before.includes(from))
    throw Error(`${file} has no ${JSON.stringify(from.slice(0, 50))}`);
  writeFileSync(path, before.replace(from, to));
}

function append(cwd, file, text) {
  writeFileSync(join(cwd, file), readFileSync(join(cwd, file), 'utf8') + text);
}

// --- Data ------------------------------------------------------------------------------------

/** 44 plausible orders, newest a few hours old, from a fixed seed so every run matches. */
function ordersData() {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const people = [
    ['Dana Whitfield', 'US', 'America/New_York'],
    ['Priya Raman', 'US', 'America/Los_Angeles'],
    ['Tomás Herrera', 'US', 'America/Chicago'],
    ['Clara Jensen', 'DE', 'Europe/Berlin'],
    ['Oliver Hargreaves', 'GB', 'Europe/London'],
    ['Mei Tanaka', 'CA', 'America/Toronto'],
    ['Jonas Albrecht', 'DE', 'Europe/Berlin'],
    ['Hannah Okafor', 'US', 'America/Los_Angeles'],
    ['Sam Reilly', 'US', 'America/Denver'],
    ['Léa Fontaine', 'GB', 'Europe/London'],
  ];
  const products = [
    ['GUJI-250', 1650],
    ['HUILA-250', 1500],
    ['HUILA-1K', 5200],
    ['SUMATRA-250', 1450],
    ['DECAF-250', 1700],
  ];
  const statuses = [
    'delivered',
    'delivered',
    'shipped',
    'packed',
    'roasting',
    'placed',
  ];
  const orders = [];
  for (let index = 0; index < 44; index++) {
    const [customer, country, tz] = pick(people);
    const hoursAgo = 3 + index * 17 + Math.floor(random() * 9);
    const lines = 1 + Math.floor(random() * 3);
    orders.push({
      id: `ord_${1044 - index}`,
      customer,
      email:
        customer
          .toLowerCase()
          .replace(/[^a-z]+/g, '.')
          .replace(/\.$/, '') + '@example.com',
      status:
        index < 6
          ? statuses[Math.min(5, 5 - index)]
          : pick(statuses.slice(0, 3)),
      placedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
      shipTo: { country, tz },
      items: Array.from({ length: lines }, () => {
        const [sku, unitCents] = pick(products);
        return { sku, qty: 1 + Math.floor(random() * 3), unitCents };
      }),
    });
  }
  // The order the invoice-date bug report is about: 5:40 pm Pacific is already tomorrow in UTC.
  const bug = orders.find((order) => order.id === 'ord_1007');
  Object.assign(bug, {
    customer: 'Priya Raman',
    email: 'priya.raman@example.com',
    status: 'delivered',
    placedAt: '2025-03-15T00:40:00.000Z',
    shipTo: { country: 'US', tz: 'America/Los_Angeles' },
  });
  return orders;
}

// --- Tidewater: the repository ---------------------------------------------------------------

function buildTidewater() {
  const repo = join(ROOT, 'tidewater');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', ABHI.name]);
  git(repo, ['config', 'user.email', ABHI.email]);
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n.env\n*.log\n');

  overlay('base-1', 'tidewater', repo);
  mkdirSync(join(repo, 'data'), { recursive: true });
  writeFileSync(
    join(repo, 'data/orders.json'),
    JSON.stringify(ordersData(), null, 2) + '\n',
  );
  commit(repo, 'Start the orders API with pricing and invoice dates', MAYA, 41);
  overlay('base-2', 'tidewater', repo);
  commit(repo, 'Add orders, inventory and the HTTP server', MAYA, 33);
  overlay('base-3', 'tidewater', repo);
  commit(repo, 'Add a dashboard page and inventory tests', ABHI, 19);
  git(repo, ['tag', 'v0.4.0']);
  return repo;
}

/** Makes a worktree on `abhi/<name>` off main, the way Bonfire does. */
function addWorktree(repo, name) {
  const path = join(WORKTREES, 'tidewater', name);
  git(repo, ['worktree', 'add', '-q', '-b', `abhi/${name}`, path, 'main']);
  return path;
}

function buildTidewaterWorkspaces(repo) {
  // atlas: merged, so main has it before the others branch.
  const atlas = addWorktree(repo, 'atlas');
  overlay('atlas', 'tidewater', atlas);
  edit(
    atlas,
    'src/server.js',
    "import { readFile } from 'node:fs/promises';",
    "import { readFileSync } from 'node:fs';\nimport { readFile } from 'node:fs/promises';",
  );
  edit(
    atlas,
    'src/server.js',
    'const PORT = Number(process.env.PORT ?? 3000);',
    "const PORT = Number(process.env.PORT ?? 3000);\nconst { version } = JSON.parse(\n  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),\n);",
  );
  edit(
    atlas,
    'src/server.js',
    "  if (request.method === 'GET' && url.pathname === '/') {",
    "  if (request.method === 'GET' && url.pathname === '/health')\n    return send(response, 200, {\n      status: 'ok',\n      version,\n      uptimeSeconds: Math.round(process.uptime()),\n    });\n  if (request.method === 'GET' && url.pathname === '/') {",
  );
  commit(atlas, 'Add a /health endpoint for the load balancer', ABHI, 6);
  git(
    repo,
    [
      'merge',
      '-q',
      '--no-ff',
      'abhi/atlas',
      '-m',
      'Merge pull request #12 from abhi/atlas\n\nAdd a /health endpoint for the load balancer',
    ],
    ABHI,
    5,
  );

  // kyoto: one commit and uncommitted work, in two files and a new test.
  const kyoto = addWorktree(repo, 'kyoto');
  edit(
    kyoto,
    'src/orders.js',
    `/** Every order, newest first, optionally only those with one status. */
export function listOrders({ status } = {}) {
  return orders
    .filter((order) => !status || order.status === status)
    .toSorted((a, b) => b.placedAt.localeCompare(a.placedAt))
    .map(withTotals);
}`,
    `const MAX_PAGE_SIZE = 100;

/**
 * One page of orders, newest first, optionally only those with one status. The page size is
 * kept between 1 and 100; \`total\` counts every match, not just this page.
 */
export function listOrders({ status, page = 1, pageSize = 25 } = {}) {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const matches = orders
    .filter((order) => !status || order.status === status)
    .toSorted((a, b) => b.placedAt.localeCompare(a.placedAt));
  const start = (Math.max(1, page) - 1) * size;
  return {
    data: matches.slice(start, start + size).map(withTotals),
    page: Math.max(1, page),
    pageSize: size,
    total: matches.length,
    totalPages: Math.max(1, Math.ceil(matches.length / size)),
  };
}`,
  );
  writeFileSync(
    join(kyoto, 'test/orders.test.js'),
    `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOrder, getOrder, listOrders } from '../src/orders.js';

test('orders list newest first', () => {
  const [first, second] = listOrders().data;
  assert.ok(first.placedAt >= second.placedAt);
});

test('listing can be narrowed to one status', () => {
  const { data } = listOrders({ status: 'shipped' });
  assert.ok(data.length > 0);
  assert.ok(data.every((order) => order.status === 'shipped'));
});

test('pageSize is capped at 100', () => {
  assert.equal(listOrders({ pageSize: 5000 }).pageSize, 100);
  assert.equal(listOrders({ pageSize: 0 }).pageSize, 1);
});

test('the last page can be short', () => {
  const { total } = listOrders();
  const last = listOrders({ page: Math.ceil(total / 10), pageSize: 10 });
  assert.equal(last.data.length, total % 10 || 10);
});

test('a page past the end is empty', () => {
  const result = listOrders({ page: 99 });
  assert.deepEqual(result.data, []);
  assert.ok(result.total > 0);
});

test('an order carries its totals', () => {
  const order = getOrder('ord_1001');
  assert.equal(order.totalCents, order.subtotalCents + order.shippingCents + order.taxCents);
});

test('an order needs an email and an item', () => {
  assert.throws(() => createOrder({ email: 'nope', items: [] }), /valid email/);
  assert.throws(() => createOrder({ email: 'a@b.co', items: [] }), /at least one item/);
});
`,
  );
  commit(kyoto, 'Paginate the order listing in the store', ABHI, 0.2);
  edit(
    kyoto,
    'src/server.js',
    `    const status = url.searchParams.get('status') ?? undefined;
    return send(response, 200, listOrders({ status }));`,
    `    const status = url.searchParams.get('status') ?? undefined;
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 25);
    if (![page, pageSize].every((value) => Number.isInteger(value) && value > 0))
      return send(response, 400, { error: 'page and pageSize must be positive integers.' });
    return send(response, 200, listOrders({ status, page, pageSize }));`,
  );
  edit(
    kyoto,
    'public/index.html',
    "      fetch('/api/orders')\n        .then((response) => response.json())\n        .then((orders) => {",
    "      const page = Number(new URLSearchParams(location.search).get('page') ?? 1);\n      fetch('/api/orders?page=' + page)\n        .then((response) => response.json())\n        .then(({ data: orders, totalPages }) => {\n          document.getElementById('pager').innerHTML =\n            (page > 1 ? '<a href=\"?page=' + (page - 1) + '\">Previous</a> ' : '') +\n            'Page ' + page + ' of ' + totalPages +\n            (page < totalPages ? ' <a href=\"?page=' + (page + 1) + '\">Next</a>' : '');",
  );
  edit(
    kyoto,
    'public/index.html',
    '      </table>\n',
    '      </table>\n      <p id="pager"></p>\n',
  );
  edit(
    kyoto,
    'README.md',
    '| GET    | `/api/orders`      | Lists orders. Filter with `?status=`. |',
    '| GET    | `/api/orders`      | One page of orders. `?status=`, `?page=`, `?pageSize=` (1–100, default 25). |',
  );
  append(
    kyoto,
    'README.md',
    '\n## Upgrading\n\n`GET /api/orders` returns `{ data, page, pageSize, total, totalPages }` instead of a\nbare array. Update any client that reads the response as a list.\n',
  );

  // serengeti: a failing test committed, the fix not yet.
  const serengeti = addWorktree(repo, 'serengeti');
  append(
    serengeti,
    'test/dates.test.js',
    `
test('an evening order is dated in the customer’s time zone', () => {
  // 5:40 pm in Los Angeles on the 14th is already the 15th in UTC.
  assert.equal(formatInvoiceDate('2025-03-15T00:40:00Z', 'America/Los_Angeles'), '2025-03-14');
});
`,
  );
  commit(serengeti, 'Add a failing test for evening invoice dates', ABHI, 1);
  edit(
    serengeti,
    'src/dates.js',
    `/** The date printed on an invoice, as YYYY-MM-DD. */
export function formatInvoiceDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}`,
    `/**
 * The date printed on an invoice, as YYYY-MM-DD, in the customer's time zone so an evening
 * order isn't dated tomorrow. Without a zone it is the UTC day.
 */
export function formatInvoiceDate(iso, timeZone = 'UTC') {
  // The en-CA locale prints dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}`,
  );
  edit(
    serengeti,
    'src/server.js',
    'formatInvoiceDate(order.placedAt)',
    'formatInvoiceDate(order.placedAt, order.shipTo.tz)',
  );

  // fuji: the limiter committed, the wiring and its tests not.
  const fuji = addWorktree(repo, 'fuji');
  overlay('fuji-commit', 'tidewater', fuji);
  commit(fuji, 'Add a token-bucket rate limiter', ABHI, 0.3);
  overlay('fuji-wip', 'tidewater', fuji);
  edit(
    fuji,
    'src/server.js',
    "import { formatInvoiceDate } from './dates.js';",
    "import { formatInvoiceDate } from './dates.js';\nimport { createRateLimiter } from './rate-limit.js';",
  );
  edit(
    fuji,
    'src/server.js',
    'const PORT = Number(process.env.PORT ?? 3000);',
    `const PORT = Number(process.env.PORT ?? 3000);
const take = createRateLimiter({ perMinute: 60, burst: 20 });

/** The client's address; behind a proxy, set TRUST_PROXY=1 to use the first forwarded one. */
function clientKey(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (process.env.TRUST_PROXY === '1' && forwarded) return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress ?? 'unknown';
}`,
  );
  edit(
    fuji,
    'src/server.js',
    'async function route(request, response, url) {\n',
    `async function route(request, response, url) {
  if (url.pathname.startsWith('/api/')) {
    const verdict = take(clientKey(request));
    if (!verdict.allowed) {
      response.setHeader('retry-after', String(verdict.retryAfterSeconds));
      return send(response, 429, { error: 'Too many requests.' });
    }
  }
`,
  );

  // yakushima: an abandoned spike. Its branch stays; its folder is gone.
  const yakushima = addWorktree(repo, 'yakushima');
  overlay('yakushima', 'tidewater', yakushima);
  edit(
    yakushima,
    'package.json',
    '  "engines": {',
    '  "dependencies": {\n    "fastify": "^5.0.0"\n  },\n  "engines": {',
  );
  commit(yakushima, 'Spike: port the routes to Fastify', ABHI, 8);
  git(repo, ['worktree', 'remove', '--force', yakushima]);

  // erebus: just made, nothing done in it.
  const erebus = addWorktree(repo, 'erebus');

  return { atlas, kyoto, serengeti, fuji, yakushima, erebus };
}

// --- Marlow: a second project ----------------------------------------------------------------

function buildMarlow() {
  const repo = join(ROOT, 'marlow-docs');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', ABHI.name]);
  git(repo, ['config', 'user.email', ABHI.email]);
  overlay('base', 'marlow', repo);
  commit(repo, 'Document buttons and colors', ABHI, 12);
  const path = join(WORKTREES, 'marlow-docs', 'nara');
  git(repo, ['worktree', 'add', '-q', '-b', 'abhi/nara', path, 'main']);
  overlay('nara-wip', 'marlow', path);
  return { repo, nara: path };
}

// --- App state -------------------------------------------------------------------------------

function agentPane(workspace, project, type, title, messages, extra = {}) {
  return {
    id: randomUUID(),
    projectId: project.id,
    workspaceId: workspace.id,
    type,
    title,
    model: type === 'claude' ? 'default' : 'gpt-5-codex',
    reasoningEffort: 'medium',
    approvals: 'ask',
    messages,
    usage: {
      inputTokens: 6_200 + messages.length * 900,
      cachedInputTokens: 24_000 + messages.length * 3_100,
      outputTokens: 1_800 + messages.length * 260,
      reasoningOutputTokens: 700,
      contextWindow: 200_000,
    },
    ...extra,
  };
}

function toolPane(workspace, project, type, title, extra = {}) {
  return {
    id: randomUUID(),
    projectId: project.id,
    workspaceId: workspace.id,
    type,
    title,
    ...extra,
  };
}

function buildState(paths) {
  const uuid = randomUUID;
  const tidewater = {
    id: uuid(),
    name: 'tidewater',
    path: join(ROOT, 'tidewater'),
    createdAt: NOW - 41 * DAY,
    lastOpenedAt: NOW - 600_000,
    scripts: [
      { id: uuid(), name: 'dev', command: 'npm run dev' },
      { id: uuid(), name: 'test', command: 'npm test' },
    ],
  };
  tidewater.runScriptId = tidewater.scripts[0].id;
  const marlow = {
    id: uuid(),
    name: 'marlow-docs',
    path: paths.marlow.repo,
    createdAt: NOW - 12 * DAY,
    lastOpenedAt: NOW - 2 * DAY,
    scripts: [{ id: uuid(), name: 'dev', command: 'npm run dev' }],
  };

  // Opening a project returns to the workspace last on screen.
  const workspace = (
    project,
    name,
    path,
    status,
    title,
    hoursAgo,
    extra = {},
  ) => ({
    id: uuid(),
    projectId: project.id,
    name,
    ...(title && { title }),
    branch: `abhi/${name}`,
    path,
    main: false,
    status,
    createdAt: NOW - hoursAgo * 3_600_000,
    ...extra,
  });
  const kyoto = workspace(
    tidewater,
    'kyoto',
    paths.tw.kyoto,
    'in_progress',
    'Paginate the orders endpoint',
    3.5,
  );
  const serengeti = workspace(
    tidewater,
    'serengeti',
    paths.tw.serengeti,
    'in_progress',
    'Fix invoice dates showing the wrong day',
    27,
  );
  const fuji = workspace(
    tidewater,
    'fuji',
    paths.tw.fuji,
    'in_progress',
    'Rate limit the API',
    6,
  );
  const erebus = workspace(
    tidewater,
    'erebus',
    paths.tw.erebus,
    'in_progress',
    undefined,
    0.1,
  );
  const atlas = workspace(
    tidewater,
    'atlas',
    paths.tw.atlas,
    'done',
    'Add a /health endpoint',
    74,
  );
  const yakushima = workspace(
    tidewater,
    'yakushima',
    paths.tw.yakushima,
    'archived',
    'Spike: port the routes to Fastify',
    200,
  );
  const nara = workspace(
    marlow,
    'nara',
    paths.marlow.nara,
    'in_progress',
    'Document form validation',
    2.5,
  );

  tidewater.lastWorkspaceId = kyoto.id;
  marlow.lastWorkspaceId = nara.id;

  const panes = [];
  const open = [];
  const add = (pane, opened = true) => {
    panes.push(pane);
    if (opened && !pane.archived) open.push(pane.id);
    return pane;
  };

  // kyoto: an agent that finished, with its diff and the files beside it.
  add(
    agentPane(
      kyoto,
      tidewater,
      'claude',
      'Paginate the orders endpoint',
      chats.paginateOrders(NOW),
      { workBranch: { name: 'abhi/kyoto', since: NOW - 3 * 3_600_000 } },
    ),
  );
  add(toolPane(kyoto, tidewater, 'diff', 'Code diff'));
  add(toolPane(kyoto, tidewater, 'files', 'Files'));

  // serengeti: Codex, a terminal for the failing test, and the app in a browser.
  add(
    agentPane(
      serengeti,
      tidewater,
      'codex',
      'Fix invoice dates showing the wrong day',
      chats.invoiceDates(NOW),
    ),
  );
  add(toolPane(serengeti, tidewater, 'terminal', 'Terminal'));
  add(
    toolPane(serengeti, tidewater, 'browser', 'Browser', {
      url: 'http://localhost:3000',
    }),
  );

  // fuji: two agents, a diff, and a closed pane that can be reopened from the header.
  add(
    agentPane(
      fuji,
      tidewater,
      'claude',
      'Rate limit the API',
      chats.rateLimit(NOW),
    ),
  );
  add(
    agentPane(
      fuji,
      tidewater,
      'codex',
      'Review the rate limiter',
      chats.reviewLimiter(NOW),
    ),
  );
  add(toolPane(fuji, tidewater, 'diff', 'Code diff'));
  add(
    agentPane(
      fuji,
      tidewater,
      'claude',
      'Draft the 0.5.0 changelog',
      chats.draftChangelog(NOW),
      { archived: true, closedAt: NOW - 3 * 3_600_000 },
    ),
  );

  // atlas: done and merged, its conversation still open.
  add(
    agentPane(
      atlas,
      tidewater,
      'claude',
      'Add a /health endpoint',
      chats.healthEndpoint(NOW),
    ),
  );

  // yakushima: archived with its folder gone; its pane returns when it is unarchived.
  const spike = add(
    agentPane(
      yakushima,
      tidewater,
      'claude',
      'Spike: port the routes to Fastify',
      chats.fastifySpike(NOW),
      { archived: true, closedAt: NOW - 8 * DAY },
    ),
    false,
  );
  yakushima.archivedPaneIds = [spike.id];

  // erebus has no panes at all: the launcher is all there is.

  // nara, in the second project.
  add(
    agentPane(
      nara,
      marlow,
      'claude',
      'Document form validation',
      chats.formValidationDocs(NOW),
    ),
  );
  add(toolPane(nara, marlow, 'files', 'Files'));

  return {
    version: 1,
    projects: [tidewater, marlow],
    panes,
    connections: [],
    workspaces: [kyoto, serengeti, fuji, erebus, atlas, yakushima, nara],
    layout: { paneIds: open },
    lastProjectId: tidewater.id,
    settings: { lastProvider: 'claude' },
    preferences: {},
  };
}

/** Agent states to show, by pane title: no real run could leave these in a seeded folder. */
const DEMO_STATUSES = {
  'Paginate the orders endpoint': 'done',
  'Fix invoice dates showing the wrong day': 'input',
  'Rate limit the API': 'working',
  'Document form validation': 'done',
};

function writeAppData(state) {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(join(DATA, 'conversations'), { recursive: true });
  const panes = state.panes.map((pane) => {
    writeFileSync(
      join(DATA, 'conversations', `${pane.id}.json`),
      JSON.stringify(pane.messages ?? []),
    );
    return { ...pane, messages: [] };
  });
  writeFileSync(
    join(DATA, 'state.json'),
    JSON.stringify({ ...state, panes }, null, 2),
  );
  writeFileSync(
    join(DATA, 'demo-statuses.json'),
    JSON.stringify(
      Object.fromEntries(
        state.panes
          .filter((pane) => DEMO_STATUSES[pane.title])
          .map((pane) => [pane.id, DEMO_STATUSES[pane.title]]),
      ),
    ),
  );
}

// --- Run -------------------------------------------------------------------------------------

if (!ROOT.includes('demo'))
  throw Error(`Refusing to wipe ${ROOT}: its name doesn't say demo.`);
if (existsSync(ROOT)) {
  // Worktrees point back into the repository, so they go with it.
  rmSync(ROOT, { recursive: true, force: true });
}
mkdirSync(WORKTREES, { recursive: true });

const repo = buildTidewater();
const tw = buildTidewaterWorkspaces(repo);
const marlow = buildMarlow();
writeAppData(buildState({ tw, marlow }));
console.log(`Demo ready in ${ROOT}\nRun it with: npm run dev:demo`);

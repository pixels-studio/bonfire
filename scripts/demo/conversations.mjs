/**
 * Conversations for the demo workspaces. Each one matches the work the seed script leaves in
 * its worktree, so what an agent says it did is what the Diff and Files panes show.
 */

/** Builds messages with ids and timestamps that run forward from `start`. */
function script(key, start) {
  let n = 0;
  let clock = start;
  const next = (seconds) => {
    clock += seconds * 1000;
    return clock;
  };
  const id = () => `${key}-${++n}`;
  const message = (role, kind, text, extra = {}) => ({
    id: id(),
    role,
    kind,
    text,
    status: 'complete',
    createdAt: next(extra.gap ?? 4),
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'gap')),
  });
  return {
    user: (text) => message('user', 'text', text, { gap: 40 }),
    attach: (name, size) =>
      message('user', 'attachment', name, { size, gap: 1 }),
    say: (text, durationMs = 3200) =>
      message('assistant', 'text', text, { durationMs }),
    think: (text, durationMs = 5200) =>
      message('assistant', 'thinking', text, { durationMs }),
    tool: (name, input, output = '', failed = false) =>
      message('assistant', 'tool', '', {
        status: failed ? 'failed' : 'complete',
        tool: { name, input, output },
        gap: 3,
      }),
    error: (text) => message('assistant', 'error', text, { status: 'failed' }),
    capacity: (text) =>
      message('assistant', 'capacity', text, { status: 'failed' }),
    notice: (text) => message('assistant', 'notice', text),
  };
}

const HOUR = 3_600_000;

export function paginateOrders(now) {
  const s = script('kyoto', now - 3 * HOUR);
  return [
    s.user(
      'GET /api/orders returns every order and the packing screen is getting slow. Add pagination: `page` and `pageSize` query params, pageSize capped at 100 and defaulting to 25. The response needs a total so the UI can draw page numbers.',
    ),
    s.think(
      'The list is built in orders.js and returned straight from the route. Pagination belongs in the store so the route stays thin. Changing the response from an array to an object breaks the dashboard, so I need to find every caller before changing the shape.',
    ),
    s.say('I’ll look at how the list is built and who calls it first.'),
    s.tool(
      'Grep',
      'listOrders',
      "src/orders.js:19:export function listOrders({ status } = {}) {\nsrc/server.js:3:import { createOrder, getOrder, listOrders } from './orders.js';\nsrc/server.js:35:    return send(response, 200, listOrders({ status }));\ntest/orders.test.js:4:import { createOrder, getOrder, listOrders } from '../src/orders.js';\ntest/orders.test.js:7:test('orders list newest first', () => {\ntest/orders.test.js:11:test('listing can be narrowed to one status', () => {",
    ),
    s.tool(
      'Read',
      'src/orders.js',
      "     1\timport { readFileSync } from 'node:fs';\n     2\timport { subtotal, shippingCents, taxCents, total } from './pricing.js';\n …",
    ),
    s.tool(
      'Read',
      'public/index.html',
      '    22\t    <script>\n    23\t      const money = (cents) => (cents / 100).toLocaleString(…\n …',
    ),
    s.say(
      'Callers are the route, the dashboard script in `public/index.html`, and two tests. My plan:\n\n1. `listOrders` takes `page` and `pageSize`, clamps them, and returns `{ data, page, pageSize, total, totalPages }`.\n2. The route reads the two params and rejects values that aren’t positive integers with a 400.\n3. The dashboard reads `.data` and gets a simple previous/next control.\n4. Tests cover the clamp, the last partial page, and a page past the end.',
      6100,
    ),
    s.tool('Edit', 'src/orders.js', 'The file src/orders.js has been updated.'),
    s.tool(
      'Edit',
      'test/orders.test.js',
      'The file test/orders.test.js has been updated.',
    ),
    s.tool(
      'Bash',
      'npm test',
      '▶ pricing\n  ✔ orders of $60 or more ship free (0.4ms)\n  ✔ smaller orders pay for shipping by country (0.1ms)\n  ✔ tax follows the destination country (0.1ms)\n  ✔ the total adds subtotal, shipping and tax (0.1ms)\n▶ orders\n  ✔ orders list newest first (0.6ms)\n  ✔ listing can be narrowed to one status (0.2ms)\n  ✔ pageSize is capped at 100 (0.1ms)\n  ✔ the last page can be short (0.1ms)\n  ✔ a page past the end is empty (0.1ms)\n  ✔ an order carries its totals (0.1ms)\n  ✔ an order needs an email and an item (0.3ms)\nℹ tests 17\nℹ pass 17\nℹ fail 0',
    ),
    s.tool('Edit', 'src/server.js', 'The file src/server.js has been updated.'),
    s.tool(
      'Edit',
      'public/index.html',
      'The file public/index.html has been updated.',
    ),
    s.say(
      'Pagination is in. Summary:\n\n- **`src/orders.js`**: `listOrders({ status, page = 1, pageSize = 25 })` now returns `{ data, page, pageSize, total, totalPages }`. `pageSize` is clamped to 1–100.\n- **`src/server.js`**: `GET /api/orders?page=2&pageSize=50` works; non-numeric or zero values return `400`.\n- **`public/index.html`**: the dashboard reads `.data` and has Previous / Next buttons.\n- **Tests**: 3 new, all 17 pass.\n\n**Breaking change:** the response is an object now, not an array. The only consumer in this repo is the dashboard, which I updated, but the packing screen app will need the same change before this deploys.',
      7400,
    ),
    s.user(
      'Update the README endpoint table too, and mention the breaking change.',
    ),
    s.tool('Edit', 'README.md', 'The file README.md has been updated.'),
    s.say(
      'Done. The `/api/orders` row now lists `?status=`, `?page=` and `?pageSize=`, and there’s a short **Upgrading** note under the table about the new response shape.',
    ),
  ];
}

export function invoiceDates(now) {
  const s = script('serengeti', now - 26 * HOUR);
  return [
    s.user(
      'Support says customers in California get an invoice dated the next day when they order in the evening. Example: ord_1007, placed 2025-03-14 at 5:40pm Pacific, shows 2025-03-15 on the invoice. Find out why and fix it.',
    ),
    s.think(
      'An evening order in Pacific time is already the next day in UTC. Invoice dates are produced by formatInvoiceDate, which slices an ISO string. toISOString always returns UTC, so the date is UTC’s calendar day, not the customer’s.',
    ),
    s.tool(
      'Bash',
      "node -e \"import('./src/dates.js').then(m => console.log(m.formatInvoiceDate('2025-03-15T00:40:00Z')))\"",
      '2025-03-15',
    ),
    s.say(
      'Reproduced. `formatInvoiceDate` uses `toISOString().slice(0, 10)`, which is the **UTC** calendar day. 5:40 pm Pacific on the 14th is 00:40 UTC on the 15th, so the invoice says the 15th.\n\nThe order already has `shipTo.tz`, so the fix is to format the date in that zone. I’ll add a failing test first.',
    ),
    s.tool(
      'Edit',
      'test/dates.test.js',
      'The file test/dates.test.js has been updated.',
    ),
    s.tool(
      'Bash',
      'npm test -- test/dates.test.js',
      "▶ dates\n  ✔ an invoice date is the calendar day of the order (0.4ms)\n  ✔ daysBetween counts whole days (0.1ms)\n  ✖ an evening order is dated in the customer’s time zone (1.2ms)\n    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n    '2025-03-15' !== '2025-03-14'\nℹ tests 3\nℹ pass 2\nℹ fail 1",
      true,
    ),
    s.capacity('The model is overloaded right now. Try again in a moment.'),
    s.user('Try again.'),
    s.say(
      "The test fails the way support described. Now the fix: `formatInvoiceDate(iso, timeZone = 'UTC')` formats with `Intl.DateTimeFormat` in the `en-CA` locale, which prints `YYYY-MM-DD`, and the order route passes `order.shipTo.tz`.",
      4800,
    ),
    s.tool('Edit', 'src/dates.js', 'The file src/dates.js has been updated.'),
    s.tool('Edit', 'src/server.js', 'The file src/server.js has been updated.'),
    s.tool(
      'Bash',
      'npm test',
      '▶ dates\n  ✔ an invoice date is the calendar day of the order (0.4ms)\n  ✔ daysBetween counts whole days (0.1ms)\n  ✔ an evening order is dated in the customer’s time zone (0.7ms)\nℹ tests 15\nℹ pass 15\nℹ fail 0',
    ),
    s.say(
      'Fixed: ord_1007 now shows **2025-03-14**. Two things worth knowing:\n\n- Orders with no `shipTo.tz` still use UTC, so nothing changes for them.\n- Invoices already sent keep their old dates. If support wants those corrected, that’s a separate backfill.',
    ),
  ];
}

export function rateLimit(now) {
  const s = script('fuji', now - 5 * HOUR);
  return [
    s.user(
      'We got hammered by a scraper over the weekend, about 40 requests a second on /api/orders. Add rate limiting: a per-IP token bucket, 60 requests a minute with a burst of 20, answering 429 with a Retry-After header. Keep it dependency-free.',
    ),
    s.attach('access-log-sat.png', 184_320),
    s.think(
      'No dependencies, so a small in-memory token bucket. Keyed by IP, refilled lazily on each take so there’s no timer to clean up. Behind a proxy the IP is x-forwarded-for, but trusting that blindly lets a client spoof it, so it should be opt-in.',
      7800,
    ),
    s.tool(
      'TodoWrite',
      '5 tasks',
      '1. [x] Write the token bucket (src/rate-limit.js)\n2. [x] Unit-test refill, burst and per-client buckets\n3. [ ] Wire it into the server before routing\n4. [ ] Send 429 with Retry-After and a JSON body\n5. [ ] Make x-forwarded-for opt-in (TRUST_PROXY=1)',
    ),
    s.say(
      'I’ll write the limiter as a pure function over an injectable clock so the tests don’t need real time.',
    ),
    s.tool(
      'Write',
      'src/rate-limit.js',
      'File created successfully at: src/rate-limit.js',
    ),
    s.tool(
      'Write',
      'test/rate-limit.test.js',
      'File created successfully at: test/rate-limit.test.js',
    ),
    s.tool(
      'Bash',
      'node --test test/rate-limit.test.js',
      '✔ a client can burst, then is refused (0.8ms)\n✔ tokens refill over time (0.1ms)\n✔ clients have separate buckets (0.1ms)\nℹ tests 3\nℹ pass 3\nℹ fail 0',
    ),
    s.notice('Context compacted'),
    s.say('Limiter and tests are done and passing. Next is the server wiring.'),
    s.tool('Edit', 'src/server.js', 'The file src/server.js has been updated.'),
    s.tool(
      'Bash',
      'PORT=3999 node src/server.js & sleep 1; for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " localhost:3999/api/orders; done',
      '200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 429 429 429 429 429',
    ),
    s.error(
      'Claude Code process exited with code 1: could not read the working tree (EMFILE: too many open files, watch). Try again.',
    ),
    s.user('Keep going — the 429s look right. Finish the proxy part.'),
    s.say(
      'The burst of 20 passes and the rest are refused, as intended. I’ll finish the proxy handling now: the client key is the socket address unless `TRUST_PROXY=1`, in which case it’s the first entry of `x-forwarded-for`.',
      5200,
    ),
    s.tool('Edit', 'src/server.js', 'The file src/server.js has been updated.'),
    s.say(
      'The limiter is wired in. `/api/*` is limited; the dashboard page and static files aren’t. Everything left is documentation: I’d add a short “Rate limits” section to the README. Want me to?',
    ),
  ];
}

export function reviewLimiter(now) {
  const s = script('fuji-review', now - 2 * HOUR);
  return [
    s.user(
      'Review src/rate-limit.js for bugs. Specifically: can memory grow without bound, and is there a race with concurrent requests?',
    ),
    s.think(
      'Node is single-threaded and take() is synchronous, so there is no race between requests. Memory is the real issue: every distinct key adds a bucket and none are ever removed. A scraper rotating IPs would grow the map forever.',
      6400,
    ),
    s.tool(
      'Read',
      'src/rate-limit.js',
      '     1\t/**\n     2\t * A token bucket per client: …',
    ),
    s.say(
      '**No race.** `take` runs to completion synchronously, so two requests can never interleave inside it.\n\n**Memory does grow.** Each new key adds an entry to `buckets` and nothing removes it. A client rotating IPs fills the map indefinitely.\n\nSuggested fix: when a bucket has refilled to `burst`, it is indistinguishable from a new one, so it can be deleted. Sweep every N calls:\n\n```js\nif (++calls % 1000 === 0)\n  for (const [key, b] of buckets)\n    if (b.tokens + (time - b.at) * refillPerMs >= burst) buckets.delete(key);\n```\n\nOne smaller point: `retryAfterSeconds` rounds up, which is right for a `Retry-After` header.',
      5100,
    ),
  ];
}

export function draftChangelog(now) {
  const s = script('fuji-changelog', now - 9 * HOUR);
  return [
    s.user('Draft a changelog entry for 0.5.0 from the commits since 0.4.0.'),
    s.tool(
      'Bash',
      'git log v0.4.0..HEAD --oneline',
      'a41c9e0 Add /health endpoint\n3be7d12 Fix inventory reserve off-by-one\n9d0f5a8 Return 422 for invalid orders',
    ),
    s.say(
      '## 0.5.0\n\n### Added\n- `GET /health` reports status, version and uptime.\n\n### Fixed\n- Reserving the last bag of a SKU no longer fails.\n- Invalid orders return `422` instead of `500`.',
    ),
  ];
}

export function healthEndpoint(now) {
  const s = script('atlas', now - 72 * HOUR);
  return [
    s.user(
      'Add a /health endpoint for the load balancer. It should return status, the version from package.json, and uptime in seconds. No auth.',
    ),
    s.tool(
      'Read',
      'src/server.js',
      "     1\timport { createServer } from 'node:http';\n …",
    ),
    s.tool('Edit', 'src/server.js', 'The file src/server.js has been updated.'),
    s.tool(
      'Write',
      'test/health.test.js',
      'File created successfully at: test/health.test.js',
    ),
    s.tool(
      'Bash',
      'npm test',
      '✔ /health reports the version and uptime (14.2ms)\nℹ tests 14\nℹ pass 14\nℹ fail 0',
    ),
    s.say(
      '`GET /health` returns `{ "status": "ok", "version": "0.4.0", "uptimeSeconds": 12 }`. The version is read from `package.json` once at startup. It’s added before the API routes, so any future auth middleware won’t cover it unless it’s added deliberately.',
    ),
  ];
}

export function fastifySpike(now) {
  const s = script('yakushima', now - 8 * 24 * HOUR);
  return [
    s.user(
      'Spike only, nothing to merge: port the routes to Fastify and tell me whether it’s worth it. Measure /api/orders before and after.',
    ),
    s.think(
      'Fastify’s schema-based serialization is usually where the speedup shows. The list endpoint returns ~40 orders with nested items, so it should benefit. I need the same hardware and the same autocannon settings for both runs.',
    ),
    s.tool('Bash', 'npm install fastify', 'added 38 packages in 4s'),
    s.tool(
      'Write',
      'src/server.fastify.js',
      'File created successfully at: src/server.fastify.js',
    ),
    s.tool(
      'Bash',
      'npx autocannon -d 10 -c 50 localhost:3000/api/orders',
      'node:http      ──  9,812 req/s   p99 11 ms\nfastify        ── 12,744 req/s   p99  8 ms',
    ),
    s.say(
      '**Result: about 30% more throughput** (9.8k → 12.7k req/s) and a lower p99, but at our traffic that’s not the bottleneck. In exchange the project goes from **0 to 38 dependencies**.\n\nMy recommendation is to stay on `node:http` for now. If we outgrow it, the spike branch has all four routes ported, so it’s a small job to pick up again.',
      6200,
    ),
  ];
}

export function formValidationDocs(now) {
  const s = script('nara', now - 2 * HOUR);
  return [
    s.user(
      'Write a docs page on form validation: when to validate, where messages go, and focus handling after a failed submit. Match the tone of buttons.md.',
    ),
    s.tool('Read', 'docs/buttons.md', '     1\t# Buttons\n     2\t\n …'),
    s.tool(
      'Write',
      'docs/forms.md',
      'File created successfully at: docs/forms.md',
    ),
    s.say(
      'Added `docs/forms.md` with three sections: Labels, Validation (on blur, then on change once invalid) and Layout. I kept it short like the buttons page and didn’t link to it yet; it isn’t in the sidebar until `build.js` lists it.',
    ),
  ];
}

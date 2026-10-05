import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readClaudeLog,
  readCodexLog,
  summarize,
  TokenUsage,
  type UsageRecord,
} from '../electron/main/token-usage';

const NOW = new Date(2026, 9, 3, 15, 30).getTime();
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();

const record = (over: Partial<UsageRecord>): UsageRecord => ({
  key: String(Math.random()),
  at: at(3),
  provider: 'claude',
  model: 'claude-sonnet-5-5',
  input: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  output: 0,
  ...over,
});

const jsonl = (...lines: object[]) =>
  lines.map((line) => JSON.stringify(line)).join('\n');

async function logFile(name: string, content: string) {
  const file = join(await mkdtemp(join(tmpdir(), 'bonfire-tokens-')), name);
  await writeFile(file, content);
  return file;
}

test('a Claude reply logged in several chunks counts once, with its final usage', async () => {
  const entry = (output: number) => ({
    type: 'assistant',
    timestamp: new Date(at(3)).toISOString(),
    requestId: 'req_1',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
        cache_creation: { ephemeral_1h_input_tokens: 20 },
        output_tokens: output,
      },
    },
  });
  const file = await logFile(
    'a.jsonl',
    jsonl(entry(5), { type: 'user', message: { content: 'hi' } }, entry(30), {
      ...entry(1),
      message: { ...entry(1).message, model: '<synthetic>' },
    }),
  );
  const records = await readClaudeLog(file);
  assert.equal(records.length, 1);
  assert.deepEqual(
    [
      records[0].input,
      records[0].cacheRead,
      records[0].cacheWrite5m,
      records[0].cacheWrite1h,
      records[0].output,
    ],
    [2, 100, 30, 20, 30],
  );
});

test('Codex running totals become one call per increase, with cached tokens split out of input', async () => {
  const count = (
    total: number,
    input: number,
    cached: number,
    output: number,
  ) => ({
    type: 'event_msg',
    timestamp: new Date(at(3)).toISOString(),
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          total_tokens: total,
        },
      },
    },
  });
  const file = await logFile(
    'rollout.jsonl',
    jsonl(
      { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
      count(1100, 1000, 400, 100),
      count(1100, 1000, 400, 100), // repeated report of the same total
      count(2500, 2200, 1000, 300),
    ),
  );
  const records = await readCodexLog(file);
  assert.deepEqual(
    records.map(({ model, input, cacheRead, output }) => [
      model,
      input,
      cacheRead,
      output,
    ]),
    [
      ['gpt-5.6-sol', 600, 400, 100],
      ['gpt-5.6-sol', 600, 600, 200],
    ],
  );
});

test('summarize totals, prices, and savings only what falls inside the range', () => {
  const stats = summarize(
    [
      record({ input: 1_000_000, cacheRead: 2_000_000, output: 500_000 }),
      record({ at: at(1), input: 1_000_000 }), // yesterday, so outside today
      record({
        at: at(3),
        provider: 'codex',
        model: 'gpt-5.6-sol',
        input: 10,
        output: 5,
      }),
    ],
    'today',
    NOW,
  );
  assert.equal(stats.totals.processed, 3_500_015);
  assert.equal(stats.totals.cachedInput, 2_000_000);
  assert.equal(stats.totals.uncachedInput, 1_000_010);
  assert.equal(stats.totals.output, 500_005);
  // Sonnet 5.5: $2 in, $0.20 cached, $10 out.
  assert.ok(Math.abs(stats.totals.cacheSavings - 3.6) < 1e-9);
  const sonnet = stats.models.find(({ key }) => key === 'claude-sonnet-5-5');
  assert.ok(Math.abs(sonnet!.cost! - (2 + 0.4 + 5)) < 1e-9);
  assert.equal(
    stats.models.find(({ provider }) => provider === 'codex')!.cost,
    null,
  );
});

test('today is bucketed by hour up to now, longer ranges by day', () => {
  const hourly = summarize([record({ at: at(3, 9), output: 7 })], 'today', NOW);
  assert.equal(hourly.series.length, 16); // 00:00 through 15:00
  assert.deepEqual(hourly.series[9], { at: at(3, 9), claude: 7, codex: 0 });

  const daily = summarize(
    [record({ at: at(3), output: 4 }), record({ at: at(1), output: 6 })],
    '7d',
    NOW,
  );
  assert.equal(daily.series.length, 7);
  assert.deepEqual(
    daily.series.map(({ claude }) => claude),
    [0, 0, 0, 0, 6, 0, 4],
  );
  assert.ok(daily.series.every(({ codex }) => codex === 0));
  assert.deepEqual(
    daily.days.map(({ key }) => key),
    ['2026-10-03', '2026-10-01'],
  );
});

test('a call counted twice across logs is counted once', () => {
  const stats = summarize(
    [record({ key: 'same', output: 9 }), record({ key: 'same', output: 9 })],
    'today',
    NOW,
  );
  assert.equal(stats.totals.output, 9);
});

test('a growing log is read from where the last look stopped, each call counted once', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bonfire-tokens-home-'));
  const folder = join(home, '.claude', 'projects', 'p');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'session.jsonl');
  const entry = (id: string, output: number) => ({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    requestId: `req_${id}`,
    message: {
      id,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 1, output_tokens: output },
    },
  });
  const usage = new TokenUsage(home);
  const output = async () => (await usage.stats('today')).totals.output;

  // The last line has no newline yet, as when the CLI is mid-write.
  await writeFile(
    file,
    `${JSON.stringify(entry('a', 10))}\n${JSON.stringify(entry('b', 5))}`,
  );
  assert.equal(await output(), 15);
  // The same reply grows, a new one starts, and half a line is still on its way.
  await appendFile(
    file,
    `\n${JSON.stringify(entry('b', 7))}\n${JSON.stringify(entry('c', 3))}\n{"type":"assist`,
  );
  assert.equal(await output(), 20);
  // A log that was rewritten shorter is read again from the start.
  await writeFile(file, `${JSON.stringify(entry('z', 2))}\n`);
  assert.equal(await output(), 2);
});

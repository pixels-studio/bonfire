import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  AssistantProvider,
  TokenRange,
  TokenRow,
  TokenStats,
} from '../../shared/contracts';
import { cacheSavingsOf, costOf, priceFor, type TokenCounts } from './pricing';

/** One model call found in a session log. */
export type UsageRecord = TokenCounts & {
  /** Identifies the call, so a log copied into a resumed session counts once. */
  key: string;
  /** Milliseconds since the epoch. */
  at: number;
  provider: AssistantProvider;
  model: string;
};

const HOUR_MS = 3_600_000;
const OPEN_FILES = 16;
const RANGE_DAYS: Record<Exclude<TokenRange, 'today'>, number> = {
  '7d': 7,
  '30d': 30,
};

function startOfDay(at: number, daysBack = 0) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysBack);
  return date.getTime();
}

function dayKey(at: number) {
  const date = new Date(at);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** When a range begins: local midnight today, or that many days back. */
export function rangeStart(range: TokenRange, now: number) {
  return startOfDay(now, range === 'today' ? 0 : RANGE_DAYS[range] - 1);
}

const processed = (counts: TokenCounts) =>
  counts.input +
  counts.cacheRead +
  counts.cacheWrite5m +
  counts.cacheWrite1h +
  counts.output;

type Group = { counts: TokenCounts; cost: number; priced: boolean };

function addTo(
  groups: Map<string, Group & { provider?: AssistantProvider }>,
  key: string,
  record: UsageRecord,
  cost: number | null,
  provider?: AssistantProvider,
) {
  const group = groups.get(key) ?? {
    provider,
    counts: {
      input: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      output: 0,
    },
    cost: 0,
    priced: false,
  };
  for (const field of Object.keys(group.counts) as (keyof TokenCounts)[])
    group.counts[field] += record[field];
  if (cost !== null) {
    group.cost += cost;
    group.priced = true;
  }
  groups.set(key, group);
}

function rows(groups: Map<string, Group & { provider?: AssistantProvider }>) {
  return [...groups].map(([key, group]): TokenRow => ({
    key,
    provider: group.provider,
    tokens: processed(group.counts),
    cost: group.priced ? group.cost : null,
  }));
}

/** Totals, a time series, and per-model and per-day breakdowns of the calls inside the range. */
export function summarize(
  records: UsageRecord[],
  range: TokenRange,
  now = Date.now(),
): TokenStats {
  const start = rangeStart(range, now);
  const totals = {
    processed: 0,
    cachedInput: 0,
    uncachedInput: 0,
    output: 0,
    cacheSavings: 0,
  };
  const models = new Map<string, Group & { provider?: AssistantProvider }>();
  const days = new Map<string, Group>();
  const buckets = new Map<number, Record<AssistantProvider, number>>();
  const seen = new Set<string>();

  // Buckets run from the start of the range to now, so quiet stretches still show as zero.
  if (range === 'today')
    for (let at = start; at <= now; at += HOUR_MS)
      buckets.set(at, { claude: 0, codex: 0 });
  else
    for (let day = 0; day < RANGE_DAYS[range]; day++)
      buckets.set(startOfDay(start, -day), { claude: 0, codex: 0 });

  for (const record of records) {
    if (record.at < start || record.at > now || seen.has(record.key)) continue;
    seen.add(record.key);
    const price = priceFor(record.provider, record.model);
    const cost = price ? costOf(price, record) : null;
    const tokens = processed(record);

    totals.processed += tokens;
    totals.cachedInput += record.cacheRead;
    totals.uncachedInput += record.input;
    totals.output += record.output;
    if (price) totals.cacheSavings += cacheSavingsOf(price, record);

    addTo(
      models,
      `${record.provider}:${record.model}`,
      record,
      cost,
      record.provider,
    );
    addTo(days, dayKey(record.at), record, cost);
    const bucket =
      range === 'today'
        ? start + Math.floor((record.at - start) / HOUR_MS) * HOUR_MS
        : startOfDay(record.at);
    const counts = buckets.get(bucket) ?? { claude: 0, codex: 0 };
    counts[record.provider] += tokens;
    buckets.set(bucket, counts);
  }

  return {
    range,
    totals,
    series: [...buckets]
      .sort(([first], [second]) => first - second)
      .map(([at, counts]) => ({ at, ...counts })),
    models: rows(models)
      .map((row) => ({ ...row, key: row.key.slice(row.key.indexOf(':') + 1) }))
      .sort((first, second) => second.tokens - first.tokens),
    days: rows(days).sort((first, second) => (first.key < second.key ? 1 : -1)),
  };
}

/** Recursively lists `.jsonl` files changed since `since`. */
async function logFiles(root: string, since: number): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return logFiles(path, since);
      if (!entry.name.endsWith('.jsonl')) return [];
      const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: 0 }));
      return mtimeMs >= since ? [path] : [];
    }),
  );
  return found.flat();
}

/** Reads a log's lines as they are appended, picking up each time where it left off. */
type LogReader = {
  /** Lines without one of these hold no usage, so they aren't parsed. */
  needles: string[];
  parse(entry: any): void;
  records(): UsageRecord[];
};

const NEWLINE = 0x0a;

/**
 * Parses the lines of `file` from byte `start` that contain one of the reader's needles, and
 * returns where the next read starts: after the last complete line. A last line with no
 * newline is parsed too, as a finished log may end that way, but read again next time, since
 * the CLI may still be writing it; readers count a line read twice once.
 */
async function readLines(file: string, start: number, reader: LogReader) {
  const parse = (line: Buffer) => {
    // Checked on the bytes, so lines without usage, most of a log, are never decoded.
    if (!reader.needles.some((needle) => line.includes(needle))) return;
    try {
      reader.parse(JSON.parse(line.toString('utf8')));
    } catch {
      // A half-written last line, since the CLIs append while we read.
    }
  };
  let read = 0;
  /** The start of a line whose newline hasn't been read yet. */
  let rest: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, { start })) {
    const bytes = chunk as Buffer;
    read += bytes.length;
    const data = rest.length ? Buffer.concat([rest, bytes]) : bytes;
    let from = 0;
    for (
      let end = data.indexOf(NEWLINE);
      end !== -1;
      end = data.indexOf(NEWLINE, from)
    ) {
      parse(data.subarray(from, end));
      from = end + 1;
    }
    rest = data.subarray(from);
  }
  if (rest.length) parse(rest);
  return start + read - rest.length;
}

/** Claude Code logs one entry per streamed chunk of a reply; each carries the reply's usage so far. */
function claudeReader(file: string): LogReader {
  const records = new Map<string, UsageRecord>();
  return {
    needles: ['"usage"'],
    records: () => [...records.values()],
    parse(entry) {
      const { message } = entry;
      const usage = message?.usage;
      if (entry.type !== 'assistant' || !usage || !message.model) return;
      if (message.model === '<synthetic>') return;
      const at = Date.parse(entry.timestamp);
      if (Number.isNaN(at)) return;
      const written = usage.cache_creation_input_tokens ?? 0;
      const written1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      const key =
        message.id && entry.requestId
          ? `${message.id}:${entry.requestId}`
          : String(entry.uuid ?? `${file}:${at}`);
      const record: UsageRecord = {
        key,
        at,
        provider: 'claude',
        model: message.model,
        input: usage.input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite5m: Math.max(written - written1h, 0),
        cacheWrite1h: written1h,
        output: usage.output_tokens ?? 0,
      };
      // Later chunks of the same reply report more output.
      if (record.output >= (records.get(key)?.output ?? -1))
        records.set(key, record);
    },
  };
}

/** Codex logs running totals per session; each increase is one call. */
function codexReader(file: string): LogReader {
  const records: UsageRecord[] = [];
  let model = 'codex';
  let previous = { total: 0, input: 0, cached: 0, output: 0 };
  return {
    needles: ['token_count', 'turn_context'],
    records: () => [...records],
    parse(entry) {
      const payload = entry.payload;
      if (entry.type === 'turn_context' && payload?.model)
        model = payload.model;
      const total = payload?.info?.total_token_usage;
      if (payload?.type !== 'token_count' || !total) return;
      const at = Date.parse(entry.timestamp);
      // A total no higher than the last, such as a line read again, is no new call.
      if (Number.isNaN(at) || total.total_tokens <= previous.total) return;
      const cached = total.cached_input_tokens ?? 0;
      const used = {
        total: total.total_tokens,
        input: total.input_tokens ?? 0,
        cached,
        output: total.output_tokens ?? 0,
      };
      // Codex counts cached tokens inside its input tokens.
      const cacheRead = used.cached - previous.cached;
      records.push({
        key: `${file}:${used.total}`,
        at,
        provider: 'codex',
        model,
        input: used.input - previous.input - cacheRead,
        cacheRead,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        output: used.output - previous.output,
      });
      previous = used;
    },
  };
}

export async function readClaudeLog(file: string): Promise<UsageRecord[]> {
  const reader = claudeReader(file);
  await readLines(file, 0, reader);
  return reader.records();
}

export async function readCodexLog(file: string): Promise<UsageRecord[]> {
  const reader = codexReader(file);
  await readLines(file, 0, reader);
  return reader.records();
}

type Cached = {
  mtimeMs: number;
  size: number;
  /** Where the next read of the file starts. */
  offset: number;
  reader: LogReader;
};

/** Reads the Claude and Codex session logs on this machine, parsing a file again only when it changed. */
export class TokenUsage {
  private readonly files = new Map<string, Cached>();
  private readonly roots: {
    path: string;
    reader: (file: string) => LogReader;
  }[];

  constructor(home = homedir()) {
    const claude = process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude');
    const codex = process.env.CODEX_HOME ?? join(home, '.codex');
    this.roots = [
      { path: join(claude, 'projects'), reader: claudeReader },
      { path: join(codex, 'sessions'), reader: codexReader },
      { path: join(codex, 'archived_sessions'), reader: codexReader },
    ];
  }

  async stats(range: TokenRange, now = Date.now()) {
    const since = rangeStart(range, now);
    const records: UsageRecord[] = [];
    for (const { path, reader } of this.roots) {
      const files = await logFiles(path, since);
      // A few at a time, so a long history doesn't open every file at once.
      for (let first = 0; first < files.length; first += OPEN_FILES)
        for (const found of await Promise.all(
          files
            .slice(first, first + OPEN_FILES)
            .map((file) => this.records(file, reader)),
        ))
          records.push(...found);
    }
    return summarize(records, range, now);
  }

  /**
   * The file's records, reading only what was appended since the last look: the logs of
   * agents at work grow all the time, and reading each again whole cost more every turn.
   */
  private async records(file: string, reader: (file: string) => LogReader) {
    const { mtimeMs, size } = await stat(file);
    let cached = this.files.get(file);
    if (cached?.mtimeMs === mtimeMs && cached.size === size)
      return cached.reader.records();
    // A log that shrank was rewritten, so it is read from the start.
    if (!cached || size < cached.size)
      cached = { mtimeMs, size, offset: 0, reader: reader(file) };
    cached.offset = await readLines(file, cached.offset, cached.reader);
    cached.mtimeMs = mtimeMs;
    cached.size = size;
    this.files.set(file, cached);
    return cached.reader.records();
  }
}

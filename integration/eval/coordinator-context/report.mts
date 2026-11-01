import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

interface Row {
  arm: string;
  turn: number;
  kind: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  costUsd: number;
  requests: number;
  firstRequest: { input: number; cacheRead: number; cacheWrite: number } | null;
  ttftMs: number | null;
  compactions: number;
  compactionCostUsd?: number;
  compactionEntries?: { firstKeptEntryId: string; tokensBefore: number; costUsd: number }[];
  recalled?: boolean;
  toolCalls: string[];
}

const { values: args } = parseArgs({
  options: { raw: { type: 'string', default: 'docs/verify/2522/raw' } },
});

function quantile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
const prompt = (r: { input: number; cacheRead: number; cacheWrite: number }) =>
  r.input + r.cacheRead + r.cacheWrite;

const summary = JSON.parse(readFileSync(join(args.raw, 'summary.json'), 'utf8')) as {
  model: string;
  spentUsd: number;
  arms: { arm: string; error: string | null }[];
};
const lines = [
  `Model ${summary.model}; spend ${summary.spentUsd.toFixed(3)} USD (all arms, including summaries).`,
  '',
  '| Arm | Live turns | Prompt tokens per turn (mean) | Cache-read share, all requests | Cache-read share, first request of turn | TTFT p50 / p90 ms | Summaries (paid) | Summary over an unchanged range | Recall with search_history | Recall without | Cost USD |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const { arm, error } of summary.arms) {
  const rows = readFileSync(join(args.raw, `${arm}.jsonl`), 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Row);
  const live = rows.filter((r) => r.kind === 'live');
  const total = live.reduce((s, r) => s + prompt(r), 0);
  const read = live.reduce((s, r) => s + r.cacheRead, 0);
  const firsts = live.flatMap((r) => (r.firstRequest ? [r.firstRequest] : []));
  const ttfts = live.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs]));
  const entries = live.flatMap((r) => r.compactionEntries ?? []);
  const unchanged = entries.filter(
    (e, i) => i > 0 && entries[i - 1]?.firstKeptEntryId === e.firstKeptEntryId,
  ).length;
  const recall = (kind: string) => {
    const r = rows.find((x) => x.kind === kind);
    return r === undefined
      ? 'n/a'
      : `${r.recalled ? 'yes' : 'no'} (${r.toolCalls.join('+') || 'no tools'})`;
  };
  const cost = rows.reduce((s, r) => s + r.costUsd + (r.compactionCostUsd ?? 0), 0);
  lines.push(
    `| ${arm}${error ? ` (error: ${error})` : ''} | ${live.length} | ${Math.round(total / Math.max(1, live.length))} | ${pct(read, total)} | ${pct(
      firsts.reduce((s, r) => s + r.cacheRead, 0),
      firsts.reduce((s, r) => s + prompt(r), 0),
    )} | ${quantile(ttfts, 0.5)} / ${quantile(ttfts, 0.9)} | ${entries.length} | ${unchanged} | ${recall('recall-with-history-tools')} | ${recall('recall-without-history-tools')} | ${cost.toFixed(3)} |`,
  );
}
const out = `${lines.join('\n')}\n`;
writeFileSync(join(args.raw, '..', 'results-table.md'), out);
process.stdout.write(out);

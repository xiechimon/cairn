import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const TEST_LINE =
  /\s(?:✓|✘)\s+\d+\s+(?:\[[^\]]+\]\s+›\s+)?(?:\S*\/)?([^/\s]+\.spec\.ts):\d+:\d+ › .* \((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000 };

export function parseWeights(log) {
  const weights = {};
  for (const line of stripVTControlCharacters(log).split('\n')) {
    const match = line.match(TEST_LINE);
    if (match) {
      weights[match[1]] =
        (weights[match[1]] ?? 0) + Math.round(Number(match[2]) * UNIT_MS[match[3]]);
    }
  }
  return weights;
}

export function mergeWeights(previous, recorded, specs) {
  const known = new Set(specs);
  return Object.fromEntries(
    Object.entries({ ...previous, ...recorded })
      .filter(([spec]) => known.has(spec))
      .map(([spec, ms]) => [spec, Math.max(1, ms)])
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runId = process.argv[2];
  if (!/^\d+$/.test(runId ?? '')) {
    console.error(
      'usage: node scripts/e2e-shard-weights.mjs <ci run id whose e2e-affected shards passed>',
    );
    process.exit(2);
  }
  const jobs = JSON.parse(
    gh(['api', `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100`]),
  ).jobs.filter((job) => job.name.startsWith('e2e-affected') && job.conclusion === 'success');
  const recorded = {};
  for (const job of jobs)
    Object.assign(
      recorded,
      parseWeights(
        gh(['api', '--allow-escape-sequences', `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`]),
      ),
    );
  if (Object.keys(recorded).length === 0) {
    console.error(`run ${runId} has no passing e2e-affected job with per-test times`);
    process.exit(1);
  }
  const file = new URL('./e2e-shard-weights.json', import.meta.url);
  const specs = readdirSync(new URL('../apps/web/e2e/', import.meta.url)).filter((name) =>
    name.endsWith('.spec.ts'),
  );
  const merged = mergeWeights(JSON.parse(readFileSync(file, 'utf8')), recorded, specs);
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(
    `recorded ${Object.keys(recorded).length} spec times from ${jobs.length} jobs; ${Object.keys(merged).length} of ${specs.length} specs have a weight`,
  );
}

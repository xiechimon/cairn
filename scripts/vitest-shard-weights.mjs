import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const FILE_LINE = /\s(?:✓|❯|×)\s+(@[\w-]+\/[\w-]+)\s+(\S+\.test\.tsx?) \([^)]*\) (\d+)ms\s*$/;

export function parseWeights(log) {
  const weights = {};
  for (const line of stripVTControlCharacters(log).split('\n')) {
    const match = line.match(FILE_LINE);
    if (match) weights[`${match[1]}:${match[2]}`] = Number(match[3]);
  }
  return weights;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runId = process.argv[2];
  if (!/^\d+$/.test(runId ?? '')) {
    console.error('usage: node scripts/vitest-shard-weights.mjs <ci run id on main>');
    process.exit(2);
  }
  const jobs = JSON.parse(
    gh(['api', `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100`]),
  ).jobs.filter((job) => job.name.startsWith('vitest-') && job.conclusion === 'success');
  if (jobs.length === 0) {
    console.error(`run ${runId} has no successful vitest jobs`);
    process.exit(1);
  }
  const weights = {};
  for (const job of jobs)
    Object.assign(
      weights,
      parseWeights(
        gh(['api', '--allow-escape-sequences', `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`]),
      ),
    );
  const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(
    new URL('./vitest-shard-weights.json', import.meta.url),
    `${JSON.stringify(sorted, null, 2)}\n`,
  );
  console.log(`wrote ${Object.keys(sorted).length} file weights from ${jobs.length} jobs`);
}

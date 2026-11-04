import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENT_MANIFEST, RESULTS_JSONL } from '../../../integration/eval/routing/experiment.mts';
import { parseArgs, runExperiment } from '../../../integration/eval/routing/run.mts';
import { REFERENCE_FILES } from '../../../integration/test/routing-reference.js';
import { startStubLlm } from '../../../integration/test/stub-llm.js';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const outBase = join(artifactRoot, 'artifacts');
rmSync(outBase, { recursive: true, force: true });
mkdirSync(outBase, { recursive: true });

const slug = REFERENCE_FILES.slugify!['lib/slug.mjs']!;
const planText = 'Lowercase the input, collapse non-alphanumeric runs to a dash, trim edges.';
const writeSlug = () => ({
  toolCall: { name: 'write', arguments: { path: 'lib/slug.mjs', content: slug } },
});
const done = () => ({ content: 'done' });
const plan = () => ({ content: planText });

function copyArtifacts(src: string, name: string): void {
  const dest = join(outBase, name);
  mkdirSync(dest, { recursive: true });
  for (const file of [EXPERIMENT_MANIFEST, RESULTS_JSONL, 'report.md']) {
    cpSync(join(src, file), join(dest, file));
  }
}

const cleanDir = mkdtempSync(join(tmpdir(), 'cairn-1987-clean-'));
const stubClean = await startStubLlm([writeSlug(), done()]);
try {
  await runExperiment(
    parseArgs([
      '--arms',
      'single',
      '--single-models',
      'stub-single',
      '--tasks',
      'slugify',
      '--reps',
      '1',
      '--timeout-s',
      '45',
      '--out',
      cleanDir,
      '--relay-url',
      stubClean.url,
      '--relay-key',
      'bench-key',
    ]),
  );
  copyArtifacts(cleanDir, 'clean');
  const row = JSON.parse(readFileSync(join(cleanDir, RESULTS_JSONL), 'utf8').trim().split('\n')[0]!);
  writeFileSync(
    join(outBase, 'clean', 'summary.txt'),
    `status=${row.status} oracle_pass=${row.oracle_pass}\n`,
  );
} finally {
  await stubClean.close();
  rmSync(cleanDir, { recursive: true, force: true });
}

const flaggedDir = mkdtempSync(join(tmpdir(), 'cairn-1987-flagged-'));
const stubFlag = await startStubLlm([
  { toolCall: { name: 'read', arguments: { path: '/etc/hostname' } } },
  writeSlug(),
  done(),
]);
try {
  await runExperiment(
    parseArgs([
      '--arms',
      'single',
      '--single-models',
      'stub-single',
      '--tasks',
      'slugify',
      '--reps',
      '1',
      '--timeout-s',
      '45',
      '--out',
      flaggedDir,
      '--relay-url',
      stubFlag.url,
      '--relay-key',
      'bench-key',
    ]),
  );
  copyArtifacts(flaggedDir, 'flagged');
  const row = JSON.parse(
    readFileSync(join(flaggedDir, RESULTS_JSONL), 'utf8').trim().split('\n')[0]!,
  );
  writeFileSync(
    join(outBase, 'flagged', 'summary.txt'),
    `status=${row.status} violations=${row.violations.join('|')}\n`,
  );
} finally {
  await stubFlag.close();
  rmSync(flaggedDir, { recursive: true, force: true });
}

const resumeDir = mkdtempSync(join(tmpdir(), 'cairn-1987-resume-'));
const stubResume = await startStubLlm([writeSlug(), done()]);
try {
  const args = [
    '--arms',
    'single',
    '--single-models',
    'stub-single',
    '--tasks',
    'slugify',
    '--reps',
    '1',
    '--timeout-s',
    '45',
    '--out',
    resumeDir,
    '--relay-url',
    stubResume.url,
    '--relay-key',
    'bench-key',
  ];
  await runExperiment(parseArgs(args));
  const before = readFileSync(join(resumeDir, RESULTS_JSONL));
  const requestsBefore = stubResume.requests.length;
  const second = await runExperiment(parseArgs(args));
  copyArtifacts(resumeDir, 'compatible-resume');
  writeFileSync(
    join(outBase, 'compatible-resume', 'summary.txt'),
    `ran=${second.ran} relayDelta=${stubResume.requests.length - requestsBefore} resultsUnchanged=${before.equals(readFileSync(join(resumeDir, RESULTS_JSONL)))}\n`,
  );
} finally {
  await stubResume.close();
  rmSync(resumeDir, { recursive: true, force: true });
}

const rejectDir = mkdtempSync(join(tmpdir(), 'cairn-1987-reject-'));
const scratch = mkdtempSync(join(tmpdir(), 'cairn-1987-prices-'));
writeFileSync(
  join(scratch, 'prices-a.json'),
  JSON.stringify({ 'stub-exec-a': { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }),
);
writeFileSync(
  join(scratch, 'prices-b.json'),
  JSON.stringify({ 'stub-exec-a': { input: 100, output: 200, cacheRead: 0, cacheWrite: 0 } }),
);
const stubReject = await startStubLlm([plan(), writeSlug(), done()]);
try {
  const base = [
    '--arms',
    'handoff',
    '--planner',
    'stub-planner',
    '--executors',
    'stub-exec-a',
    '--tasks',
    'slugify',
    '--reps',
    '1',
    '--timeout-s',
    '45',
    '--out',
    rejectDir,
    '--prices',
    join(scratch, 'prices-a.json'),
    '--relay-url',
    stubReject.url,
    '--relay-key',
    'bench-key',
  ];
  await runExperiment(parseArgs(base));
  const beforeResults = readFileSync(join(rejectDir, RESULTS_JSONL));
  const requestsBefore = stubReject.requests.length;
  const next = [...base];
  next[next.indexOf('--prices') + 1] = join(scratch, 'prices-b.json');
  let message = '';
  try {
    await runExperiment(parseArgs(next));
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  copyArtifacts(rejectDir, 'incompatible-resume');
  writeFileSync(join(outBase, 'incompatible-resume', 'rejection.txt'), `${message}\n`);
  writeFileSync(
    join(outBase, 'incompatible-resume', 'summary.txt'),
    `relayDelta=${stubReject.requests.length - requestsBefore} resultsUnchanged=${beforeResults.equals(readFileSync(join(rejectDir, RESULTS_JSONL)))}\n`,
  );
} finally {
  await stubReject.close();
  rmSync(rejectDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`artifacts written to ${outBase}`);

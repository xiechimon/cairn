// #1466 round 3 mutation runner (same shape as r2-mutate.mjs): run the named
// test file once on the unmutated sources (baseline), then apply the mutation,
// run it again, record both summaries, restore the original bytes
// (sha256-checked).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = process.argv[2];
const sha = (s) => createHash('sha256').update(s).digest('hex');

const DOT_T = 'apps/server/test/github-repo-dot-segments.test.ts';

const mutations = [
  {
    id: 'R3-M1',
    rule: 'the CI poller skips a building candidate whose stored githubRepo is not a valid GitHub repo ref',
    note: "ci-loop.ts guard reverted to the origin/main form (repoKind/githubRepo null check, then slice at '/')",
    file: 'apps/server/src/services/ci-loop.ts',
    edits: [
      {
        from: [
          '    const repoRef = githubRepoOfProject(projRow);',
          '    if (',
          '      buildRow === undefined ||',
          '      buildRow.prNumber === null ||',
          '      projRow === undefined ||',
          '      repoRef === null',
          '    ) {',
          '',
        ].join('\n'),
        to: [
          '    if (',
          '      buildRow === undefined ||',
          '      buildRow.prNumber === null ||',
          '      projRow === undefined ||',
          "      projRow.repoKind !== 'github' ||",
          '      projRow.githubRepo === null',
          '    ) {',
          '',
        ].join('\n'),
      },
      {
        from: '    const { owner, repo } = repoRef;\n',
        to: [
          "    const slash = projRow.githubRepo.indexOf('/');",
          '    const owner = projRow.githubRepo.slice(0, slash);',
          '    const repo = projRow.githubRepo.slice(slash + 1);',
          '',
        ].join('\n'),
      },
    ],
    tests: [DOT_T],
  },
];

function runVitest(tests) {
  try {
    const log = execFileSync('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', ...tests], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { status: 0, log };
  } catch (err) {
    return { status: err.status ?? 1, log: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function digest(log) {
  const lines = log.split('\n');
  return {
    failed: lines.filter((l) => /^\s+×/.test(l)).map((l) => l.replace(/\s+\d+ms$/, '').trim()),
    reasons: lines.filter((l) => /^AssertionError|^HttpError|^Error:/.test(l)).map((l) => l.trim()),
    summary: lines.filter((l) => /^\s+(Test Files|Tests)\s/.test(l)).map((l) => l.trim()),
    r7: lines.filter((l) => /R7/.test(l) && /^\s+[✓×]/.test(l)).map((l) => l.replace(/\s+\d+ms$/, '').trim()),
  };
}

const out = [];
for (const m of mutations) {
  const base = runVitest(m.tests);
  const b = digest(base.log);
  out.push(
    `## baseline (no mutation): ${m.tests.join(' ')}`,
    `vitest exit: ${base.status}`,
    ...b.summary,
    'R7 / R7b cases:',
    ...b.r7.map((l) => `  ${l}`),
    '',
  );
  const path = `${root}/${m.file}`;
  const original = readFileSync(path, 'utf8');
  let mutated = original;
  for (const e of m.edits) {
    const hits = mutated.split(e.from).length - 1;
    if (hits !== 1) throw new Error(`${m.id}: anchor occurs ${hits} times in ${m.file}`);
    mutated = mutated.replace(e.from, e.to);
  }
  writeFileSync(path, mutated);
  let res;
  try {
    res = runVitest(m.tests);
  } finally {
    writeFileSync(path, original);
  }
  if (sha(readFileSync(path, 'utf8')) !== sha(original)) throw new Error(`${m.id}: restore failed`);
  const d = digest(res.log);
  out.push(
    `## ${m.id}: ${m.rule}`,
    `file: ${m.file}`,
    `mutation: ${m.note}`,
    ...m.edits.map((e) => `  edit: ${JSON.stringify(e.from.trim())} -> ${JSON.stringify(e.to.trim())}`),
    `tests: ${m.tests.join(' ')}`,
    `vitest exit: ${res.status} (${res.status === 0 ? 'SURVIVED' : 'KILLED'})`,
    ...d.summary,
    'failing cases:',
    ...d.failed.map((l) => `  ${l}`),
    'R7 / R7b cases under the mutation:',
    ...d.r7.map((l) => `  ${l}`),
    'first assertion messages:',
    ...d.reasons.map((l) => `  ${l}`),
    '',
  );
}
process.stdout.write(`${out.join('\n')}\n`);

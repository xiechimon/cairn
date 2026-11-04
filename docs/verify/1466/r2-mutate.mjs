// #1466 round 2 mutation runner (same shape as mutate.mjs; each mutation may
// carry several anchored edits): apply one mutation, run the named test files,
// record the summary, restore the original bytes (sha256-checked).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = process.argv[2];
const sha = (s) => createHash('sha256').update(s).digest('hex');

const DOT_T = 'apps/server/test/github-repo-dot-segments.test.ts';
const TEAM_T = 'apps/server/test/project-team-guard.test.ts';
const CHIEF = 'apps/server/src/services/chief-tools.ts';

const mutations = [
  {
    id: 'R2-M1',
    rule: 'run_builds checks the project (team-scoped) before startBuilds',
    note: 'project check moved back after startBuilds, as at e87699c',
    file: CHIEF,
    edits: [
      {
        from: '        return { todoId, row, projectName: requireProjectRow(db, row.projectId, ctx.teamId).name };\n',
        to: '        return { todoId, row };\n',
      },
      {
        from: '      for (const { todoId, row, projectName } of targets) {\n',
        to: '      for (const { todoId, row } of targets) {\n',
      },
      {
        from: '        started.push(...builds);\n',
        to: '        started.push(...builds);\n        const projectName = requireProjectRow(db, row.projectId, ctx.teamId).name;\n',
      },
    ],
    tests: [TEAM_T],
  },
  {
    id: 'R2-M1b',
    rule: 'run_builds checks every todo before the first startBuilds, not one todo at a time',
    note: 'project check kept before startBuilds but inside the loop, so an own-team todo earlier in the list is started first',
    file: CHIEF,
    edits: [
      {
        from: '        return { todoId, row, projectName: requireProjectRow(db, row.projectId, ctx.teamId).name };\n',
        to: '        return { todoId, row };\n',
      },
      {
        from: '      for (const { todoId, row, projectName } of targets) {\n',
        to: '      for (const { todoId, row } of targets) {\n        const projectName = requireProjectRow(db, row.projectId, ctx.teamId).name;\n',
      },
    ],
    tests: [TEAM_T],
  },
  {
    id: 'R2-M2',
    rule: 'watch_todos checks every project before watching any todo',
    note: 'project check moved back into the watch loop, so it runs after the first todo is watched (e87699c shape)',
    file: CHIEF,
    edits: [
      {
        from: [
          '      const targets = todoIds.flatMap((todoId) => {',
          '        const record = getTodo(svc, todoId);',
          '        if (!record || record.teamId !== ctx.teamId) return [];',
          '        return [{ record, projectName: requireProjectRow(db, record.projectId, ctx.teamId).name }];',
          '      });',
          '      for (const { record, projectName } of targets) {',
          '',
        ].join('\n'),
        to: [
          '      for (const todoId of todoIds) {',
          '        const record = getTodo(svc, todoId);',
          '        if (!record || record.teamId !== ctx.teamId) continue;',
          '        const projectName = requireProjectRow(db, record.projectId, ctx.teamId).name;',
          '',
        ].join('\n'),
      },
    ],
    tests: [TEAM_T],
  },
  {
    id: 'R2-M3',
    rule: 'completeStep decides "wait for CI" through githubRepoOfProject',
    note: 'raw githubRepo column back in deliveredGithubPr, as at e87699c',
    file: 'apps/server/src/services/builds.ts',
    edits: [
      {
        from: '    const deliveredGithubPr = buildRow.prNumber !== null && githubRepoOfProject(projRow) !== null;\n',
        to: "    const deliveredGithubPr =\n      buildRow.prNumber !== null && projRow?.repoKind === 'github' && projRow.githubRepo !== null;\n",
      },
    ],
    tests: [DOT_T],
  },
];

const out = [];
for (const m of mutations) {
  const path = `${root}/${m.file}`;
  const original = readFileSync(path, 'utf8');
  let mutated = original;
  for (const e of m.edits) {
    const hits = mutated.split(e.from).length - 1;
    if (hits !== 1) throw new Error(`${m.id}: anchor occurs ${hits} times in ${m.file}`);
    mutated = mutated.replace(e.from, e.to);
  }
  writeFileSync(path, mutated);
  let log = '';
  let status = 0;
  try {
    log = execFileSync('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', ...m.tests], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
  } catch (err) {
    status = err.status ?? 1;
    log = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    writeFileSync(path, original);
  }
  if (sha(readFileSync(path, 'utf8')) !== sha(original)) throw new Error(`${m.id}: restore failed`);
  const lines = log.split('\n');
  const failed = lines.filter((l) => /^\s+×/.test(l)).map((l) => l.replace(/\s+\d+ms$/, '').trim());
  const reasons = lines.filter((l) => /^AssertionError|^HttpError|^Error:/.test(l)).map((l) => l.trim());
  const summary = lines.filter((l) => /^\s+(Test Files|Tests)\s/.test(l));
  out.push(
    `## ${m.id}: ${m.rule}`,
    `file: ${m.file}`,
    `mutation: ${m.note}`,
    ...m.edits.map((e) => `  edit: ${JSON.stringify(e.from.trim())} -> ${JSON.stringify(e.to.trim())}`),
    `tests: ${m.tests.join(' ')}`,
    `vitest exit: ${status} (${status === 0 ? 'SURVIVED' : 'KILLED'})`,
    ...summary.map((l) => l.trim()),
    'failing cases:',
    ...failed.map((l) => `  ${l}`),
    'first assertion messages:',
    ...reasons.map((l) => `  ${l}`),
    '',
  );
}
process.stdout.write(`${out.join('\n')}\n`);

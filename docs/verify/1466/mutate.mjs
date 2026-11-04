// #1466 mutation runner: apply one source mutation, run the named test files,
// record the summary, restore the original bytes (sha256-checked).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = process.argv[2];
const sha = (s) => createHash('sha256').update(s).digest('hex');

const SHARED_T = 'packages/shared/test/github-repo-ref.test.ts';
const DOT_T = 'apps/server/test/github-repo-dot-segments.test.ts';
const TEAM_T = 'apps/server/test/project-team-guard.test.ts';
const PROBE_T = 'apps/daemon/test/github-probe.test.ts';

const mutations = [
  {
    id: 'M1',
    rule: 'parseGithubRepoRef / isGithubRepoRef rejects . and .. owner or repo',
    file: 'packages/shared/src/records/project.ts',
    from: "  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;\n",
    to: '',
    tests: [SHARED_T, DOT_T, PROBE_T],
  },
  {
    id: 'M2',
    rule: 'parseGithubIssueSourceRef re-checks owner/repo through parseGithubRepoRef',
    file: 'packages/shared/src/records/todo.ts',
    from: '  const repoRef = parseGithubRepoRef(m[1] as string);',
    to: "  const [owner, repo] = (m[1] as string).split('/') as [string, string];\n  const repoRef = { owner, repo };",
    tests: [SHARED_T, DOT_T],
  },
  {
    id: 'M3',
    rule: 'server read paths (githubRepoOfProject) treat an invalid stored githubRepo as not GitHub',
    file: 'apps/server/src/services/git.ts',
    from: '  return parseGithubRepoRef(row.githubRepo);',
    to: "  const slash = row.githubRepo.indexOf('/');\n  return { owner: row.githubRepo.slice(0, slash), repo: row.githubRepo.slice(slash + 1) };",
    tests: [DOT_T],
  },
  {
    id: 'M4',
    rule: 'chief requireProjectRow filters on the caller team',
    file: 'apps/server/src/services/chief-tools.ts',
    from: '    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))',
    to: '    .where(eq(project.id, projectId))',
    tests: [TEAM_T],
  },
  {
    id: 'M5',
    rule: 'MCP requireProjectRow filters on the caller team',
    file: 'apps/server/src/services/mcp-face.ts',
    from: '    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))',
    to: '    .where(eq(project.id, projectId))',
    tests: [TEAM_T],
  },
  {
    id: 'M6',
    rule: 'chief todos tool keeps the team filter when projectId is given',
    file: 'apps/server/src/services/chief-tools.ts',
    from: '      let records = listTodos(svc, { teamId: ctx.teamId, ...(projectId ? { projectId } : {}) });',
    to: '      let records = listTodos(svc, projectId ? { projectId } : { teamId: ctx.teamId });',
    tests: [TEAM_T],
  },
  {
    id: 'M7',
    rule: 'MCP todos tool keeps the team filter when projectId is given',
    file: 'apps/server/src/services/mcp-face.ts',
    from: '      let records = listTodos(svc, { teamId: ctx.teamId, ...(projectId ? { projectId } : {}) });',
    to: '      let records = listTodos(svc, projectId ? { projectId } : { teamId: ctx.teamId });',
    tests: [TEAM_T],
  },
  {
    id: 'M8',
    rule: 'chief watch_todos skips another team todo like a missing one',
    file: 'apps/server/src/services/chief-tools.ts',
    from: '        if (!record || record.teamId !== ctx.teamId) continue;',
    to: '        if (!record) continue;',
    tests: [TEAM_T],
  },
];

const out = [];
for (const m of mutations) {
  const path = `${root}/${m.file}`;
  const original = readFileSync(path, 'utf8');
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) throw new Error(`${m.id}: anchor occurs ${hits} times in ${m.file}`);
  writeFileSync(path, original.replace(m.from, m.to));
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
  const failed = log
    .split('\n')
    .filter((l) => /^\s+×/.test(l))
    .map((l) => l.replace(/\s+\d+ms$/, '').trim());
  const summary = log.split('\n').filter((l) => /^\s+(Test Files|Tests)\s/.test(l));
  out.push(
    `## ${m.id}: ${m.rule}`,
    `file: ${m.file}`,
    `mutation: ${JSON.stringify(m.from.trim())} -> ${JSON.stringify(m.to.trim())}`,
    `tests: ${m.tests.join(' ')}`,
    `vitest exit: ${status} (${status === 0 ? 'SURVIVED' : 'KILLED'})`,
    ...summary.map((l) => l.trim()),
    'failing cases:',
    ...failed.map((l) => `  ${l}`),
    '',
  );
}
process.stdout.write(`${out.join('\n')}\n`);

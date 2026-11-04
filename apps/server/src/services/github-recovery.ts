import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { autonomousMergeAdmission, build, project, team, todo } from '../db/schema.js';
import { runGit } from '../lib/git.js';
import { type FetchLike, githubPull, isFullSha } from '../lib/github.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject } from './git.js';
import { brakeRequest, pauseGithubRepo } from './github-autonomy-brake.js';
import { githubTokenOrNull } from './github-connection.js';

export async function prepareRecoveryBranch(
  url: string,
  base: string,
  reverted: string,
  token: string,
): Promise<string> {
  if (!isFullSha(base) || !isFullSha(reverted)) throw new Error('Recovery requires full SHAs');
  const dir = await mkdtemp(join(tmpdir(), 'cairn-recovery-'));
  const branch = `cairn-recovery/${reverted.slice(0, 8)}`;
  const env = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Cairn',
    GIT_AUTHOR_EMAIL: 'cairn@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'Cairn',
    GIT_COMMITTER_EMAIL: 'cairn@users.noreply.github.com',
  };
  const git = async (...args: string[]): Promise<string> => {
    const result = await runGit(args, { cwd: dir, env, timeoutMs: 60_000 });
    if (result.code !== 0) throw new Error(`Recovery git ${args[0]} failed`);
    return result.stdout.toString('utf8').trim();
  };
  try {
    await git('init');
    await git('fetch', '--no-tags', url, base, reverted);
    await git('checkout', '--detach', base);
    const parents = (await git('show', '-s', '--format=%P', reverted)).split(' ');
    await git('revert', '--no-commit', ...(parents.length > 1 ? ['-m', '1'] : []), reverted);
    const tree = await git('write-tree');
    const sha = await git(
      'commit-tree',
      tree,
      '-p',
      base,
      '-m',
      `Revert autonomous merge ${reverted.slice(0, 8)}\n\nThis reverts commit ${reverted}.`,
    );
    await git('push', url, `${sha}:refs/heads/${branch}`);
    return branch;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function recentRecoveryTarget(
  fetchImpl: FetchLike,
  token: string,
  repo: string,
  main: string,
  target: string,
): Promise<boolean> {
  let sha = main;
  let found = false;
  for (let i = 0; i < 1000; i++) {
    const response = await brakeRequest(
      fetchImpl,
      token,
      repo,
      `commits/${sha}/check-runs?filter=latest&per_page=100`,
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      check_runs: {
        id: number;
        name: string;
        status: string;
        conclusion: string;
        app?: { slug: string };
      }[];
    };
    const latest = body.check_runs
      .filter((run) => run.name === 'check' && run.app?.slug === 'github-actions')
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.status === 'completed' && latest.conclusion === 'success') return found;
    if (sha === target) found = true;
    const commit = await brakeRequest(fetchImpl, token, repo, `git/commits/${sha}`);
    if (!commit.ok) return false;
    const parents = ((await commit.json()) as { parents: { sha: string }[] }).parents;
    const parent = parents[0]?.sha;
    if (!parent || !isFullSha(parent)) return false;
    sha = parent;
  }
  return false;
}

export async function recoverRedAutonomousMain(
  deps: BuildDeps,
  fetchImpl: FetchLike,
): Promise<void> {
  const rows = deps.db
    .select({ admission: autonomousMergeAdmission, build, project })
    .from(autonomousMergeAdmission)
    .innerJoin(build, eq(build.id, autonomousMergeAdmission.buildId))
    .innerJoin(todo, eq(todo.id, build.todoId))
    .innerJoin(project, eq(project.id, todo.projectId))
    .where(and(eq(autonomousMergeAdmission.state, 'merged'), eq(project.repoKind, 'github')))
    .orderBy(desc(autonomousMergeAdmission.landedAt))
    .all();
  const seen = new Set<string>();
  for (const row of rows) {
    const target = githubRepoOfProject(row.project);
    if (!target || row.build.prNumber === null) continue;
    const repo = `${target.owner}/${target.repo}`;
    if (seen.has(repo)) continue;
    seen.add(repo);
    const token = await githubTokenOrNull(deps, row.admission.teamId);
    if (token === null) continue;
    const mainResponse = await brakeRequest(fetchImpl, token, repo, 'branches/main');
    if (!mainResponse.ok) continue;
    const mainBody = (await mainResponse.json()) as { commit: { sha: string } };
    const main = mainBody.commit.sha;
    if (!isFullSha(main)) continue;
    const checksResponse = await brakeRequest(
      fetchImpl,
      token,
      repo,
      `commits/${main}/check-runs?filter=latest&per_page=100`,
    );
    if (!checksResponse.ok) continue;
    const checks = (await checksResponse.json()) as {
      check_runs: {
        id: number;
        name: string;
        status: string;
        conclusion: string;
        app?: { slug: string };
      }[];
    };
    const latest = checks.check_runs
      .filter((check) => check.name === 'check' && check.app?.slug === 'github-actions')
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.status !== 'completed' || latest.conclusion !== 'failure') continue;
    deps.db
      .update(team)
      .set({ autonomyPaused: true })
      .where(eq(team.id, row.admission.teamId))
      .run();
    await pauseGithubRepo(fetchImpl, token, repo, `Main check failed at ${main}.`);
    const pull = await githubPull(fetchImpl, token, target.owner, target.repo, row.build.prNumber);
    const reverted = pull?.pull?.mergeCommitSha;
    if (!reverted || !isFullSha(reverted)) continue;
    const compare = await brakeRequest(fetchImpl, token, repo, `compare/${reverted}...${main}`);
    if (!compare.ok) continue;
    const comparison = (await compare.json()) as { status: string };
    if (comparison.status !== 'ahead' && comparison.status !== 'identical') continue;
    if (!(await recentRecoveryTarget(fetchImpl, token, repo, main, reverted))) continue;
    const branch = `cairn-recovery/${reverted.slice(0, 8)}`;
    const existing = await brakeRequest(
      fetchImpl,
      token,
      repo,
      `pulls?state=all&head=${encodeURIComponent(`${target.owner}:${branch}`)}&base=main`,
    );
    if (!existing.ok) continue;
    const pulls: unknown = await existing.json();
    if (!Array.isArray(pulls)) continue;
    if (pulls.length > 0) {
      for (const pull of pulls as { number: number; state: string }[]) {
        if (pull.state !== 'open') continue;
        const labelled = await brakeRequest(
          fetchImpl,
          token,
          repo,
          `issues/${pull.number}/labels`,
          { labels: ['cairn-recovery'] },
        );
        if (!labelled.ok) throw new Error('Recovery PR labelling failed');
      }
      continue;
    }
    const label = await brakeRequest(fetchImpl, token, repo, 'labels/cairn-recovery');
    if (label.status === 404) {
      const created = await brakeRequest(fetchImpl, token, repo, 'labels', {
        name: 'cairn-recovery',
        color: 'b60205',
      });
      if (!created.ok && created.status !== 422) throw new Error('Recovery label creation failed');
    } else if (!label.ok) continue;
    const ref = await brakeRequest(fetchImpl, token, repo, `git/ref/heads/${branch}`);
    if (ref.status === 404)
      await prepareRecoveryBranch(`https://github.com/${repo}.git`, main, reverted, token);
    else if (!ref.ok) continue;
    const opened = await brakeRequest(fetchImpl, token, repo, 'pulls', {
      title: `Revert autonomous merge ${reverted.slice(0, 8)}`,
      head: branch,
      base: 'main',
      body: `## What\n\nThis reverts commit ${reverted} after main check failed at ${main}.\n\n## Verified\n\nThe recovery exception recomputes the exact revert tree before allowing this PR through the brake.\n\n## Upstream\n\nRecovery of the repository's autonomous merge.\n\n## Risk\n\nRequires review; Cairn does not merge this PR.\n\n## Acceptance\n\n- [x] Recovery branch contains the revert.\n\n## Issues\n\nAutonomy remains paused until the marker issue is closed.`,
    });
    if (!opened.ok) throw new Error('Recovery PR creation failed');
    const recovery = (await opened.json()) as { number: number };
    const labelled = await brakeRequest(
      fetchImpl,
      token,
      repo,
      `issues/${recovery.number}/labels`,
      { labels: ['cairn-recovery'] },
    );
    if (!labelled.ok) throw new Error('Recovery PR labelling failed');
  }
}

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY is required');
const api = (path, payload) => {
  const output = execFileSync(
    'gh',
    ['api', path, ...(payload ? ['--method', 'POST', '--input', '-'] : [])],
    {
      encoding: 'utf8',
      ...(payload ? { input: JSON.stringify(payload) } : {}),
    },
  );
  return output.trim() ? JSON.parse(output) : null;
};
const pages = (path) =>
  JSON.parse(execFileSync('gh', ['api', path, '--paginate', '--slurp'], { encoding: 'utf8' }));
const markers = () =>
  pages(`repos/${repo}/issues?state=open&labels=autonomy-paused&per_page=100`)
    .flat()
    .filter((issue) => !issue.pull_request);
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const shaPattern = /^[a-f0-9]{40}$/;

export function verifyRecovery(number) {
  if (!/^[1-9]\d*$/.test(number ?? '')) throw new Error('A PR number is required');
  const pr = api(`repos/${repo}/pulls/${number}`);
  if (
    pr.base.ref !== 'main' ||
    pr.commits !== 1 ||
    !pr.labels.some((label) => label.name === 'cairn-recovery')
  )
    throw new Error('Recovery metadata does not qualify');
  const commits = pages(`repos/${repo}/pulls/${number}/commits`).flat();
  if (commits.length !== 1 || commits[0].sha !== pr.head.sha)
    throw new Error('Recovery must have exactly one head commit');
  const names = [
    ...commits[0].commit.message.matchAll(/^This reverts commit ([a-f0-9]{40})\.?$/gm),
  ].map((match) => match[1]);
  if (!names.length || new Set(names).size !== names.length)
    throw new Error('Reverted SHAs are missing or duplicated');
  const main = api(`repos/${repo}/branches/main`).commit.sha;
  for (const sha of [main, pr.base.sha, pr.head.sha, ...names])
    if (!shaPattern.test(sha)) throw new Error('Invalid SHA');
  const dir = mkdtempSync(join(tmpdir(), 'cairn-recovery-'));
  try {
    git(process.cwd(), 'clone', '--shared', '--no-checkout', process.cwd(), dir);
    for (const sha of [main, pr.base.sha, pr.head.sha]) {
      try {
        git(dir, 'cat-file', '-e', `${sha}^{commit}`);
      } catch {
        git(dir, 'fetch', '--no-tags', `https://github.com/${repo}.git`, sha);
      }
    }
    const history = git(dir, 'rev-list', '--first-parent', main).split('\n');
    let green = -1;
    for (let i = 0; i < history.length; i++) {
      const runs = pages(
        `repos/${repo}/commits/${history[i]}/check-runs?filter=latest&per_page=100`,
      ).flatMap((page) => page.check_runs);
      const latest = runs
        .filter((run) => run.name === 'check' && run.app?.slug === 'github-actions')
        .sort((a, b) => b.id - a.id)[0];
      if (latest?.status === 'completed' && latest.conclusion === 'success') {
        green = i;
        break;
      }
    }
    if (green < 0 || names.some((sha) => history.indexOf(sha) < 0 || history.indexOf(sha) >= green))
      throw new Error('Reverts must follow the latest green main check');
    git(dir, 'merge-base', '--is-ancestor', pr.base.sha, main);
    git(dir, 'checkout', '--detach', pr.base.sha);
    for (const sha of names.sort((a, b) => history.indexOf(a) - history.indexOf(b))) {
      const parents = git(dir, 'show', '-s', '--format=%P', sha).split(' ');
      git(dir, 'revert', '--no-commit', ...(parents.length > 1 ? ['-m', '1'] : []), sha);
    }
    if (git(dir, 'write-tree') !== git(dir, 'rev-parse', `${pr.head.sha}^{tree}`))
      throw new Error('Recovery tree differs from the exact revert');
    console.log(`recovery: GREEN #${number}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkPull(pr, paused) {
  let allowed = !paused;
  if (paused && pr.labels.some((label) => label.name === 'cairn-recovery')) {
    try {
      verifyRecovery(String(pr.number));
      allowed = true;
    } catch {}
  }
  if (!shaPattern.test(pr.head.sha)) throw new Error('Invalid PR head SHA');
  api(`repos/${repo}/statuses/${pr.head.sha}`, {
    context: 'autonomy-brake',
    state: allowed ? 'success' : 'failure',
    description: allowed ? 'Autonomy brake permits this head' : 'Autonomous merging is paused',
  });
  return allowed;
}

function sweep(paused) {
  let failed = false;
  for (const pr of pages(`repos/${repo}/pulls?state=open&per_page=100`).flat()) {
    try {
      const allowed = checkPull(pr, paused);
      const runs = pages(
        `repos/${repo}/actions/workflows/pr-evidence.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`,
      ).flatMap((page) => page.workflow_runs);
      const latest = runs
        .filter(
          (run) =>
            run.head_sha === pr.head.sha &&
            run.pull_requests.some((pull) => pull.number === pr.number),
        )
        .sort((a, b) => b.id - a.id)[0];
      if (latest) {
        try {
          api(`repos/${repo}/actions/runs/${latest.id}/rerun`, {});
        } catch (error) {
          const run = api(`repos/${repo}/actions/runs/${latest.id}`);
          if (!['queued', 'in_progress'].includes(run.status)) throw error;
        }
      }
      if (allowed || !pr.auto_merge) continue;
      const result = JSON.parse(
        execFileSync(
          'gh',
          [
            'api',
            'graphql',
            '-f',
            'query=mutation($pullRequestId:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$pullRequestId}){pullRequest{number}}}',
            '-f',
            `pullRequestId=${pr.node_id}`,
          ],
          { encoding: 'utf8' },
        ),
      );
      if (result.errors || !result.data?.disablePullRequestAutoMerge)
        throw new Error('Disarm mutation failed');
      console.log(`#${pr.number}: disarmed`);
    } catch (error) {
      failed = true;
      console.error(error.message);
      console.log(`#${pr.number}: failed`);
    }
  }
  if (failed) process.exitCode = 1;
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'status') console.log(JSON.stringify({ paused: markers().length > 0 }));
  else if (command === 'pause') {
    const reason = args[0] === '--reason' ? args[1]?.trim() : '';
    if (!reason) throw new Error('pause --reason <text> is required');
    if (!markers().length) {
      const labels = pages(`repos/${repo}/labels?per_page=100`).flat();
      if (!labels.some((label) => label.name === 'autonomy-paused'))
        api(`repos/${repo}/labels`, { name: 'autonomy-paused', color: 'b60205' });
      api(`repos/${repo}/issues`, {
        title: 'Autonomous merging paused',
        body: `${reason}\n\nClose this issue to resume autonomous merging.`,
        labels: ['autonomy-paused'],
      });
    }
    sweep(true);
    console.log('autonomy: paused');
  } else if (command === 'sweep') sweep(markers().length > 0);
  else if (command === 'check-pr') {
    if (!/^[1-9]\d*$/.test(args[0] ?? '')) throw new Error('A PR number is required');
    const pr = api(`repos/${repo}/pulls/${args[0]}`);
    if (!checkPull({ ...pr, number: Number(args[0]) }, markers().length > 0))
      throw new Error('autonomy-paused: autonomous merging is paused');
  } else if (command === 'verify-recovery') verifyRecovery(args[0]);
  else throw new Error('Expected status, pause, sweep, check-pr, or verify-recovery');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

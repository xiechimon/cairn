import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function revertedShas(message) {
  const names = [...message.matchAll(/^This reverts commit ([a-f0-9]{40})\.?$/gm)].map(
    (match) => match[1],
  );
  if (!names.length || new Set(names).size !== names.length)
    throw new Error('Reverted SHAs are missing or duplicated');
  return names;
}

function assertExactRevertTree(dir, { baseSha, headSha, names, history }) {
  for (const sha of [baseSha, headSha, ...names])
    if (!shaPattern.test(sha)) throw new Error('Invalid SHA');
  git(dir, 'checkout', '--detach', baseSha);
  for (const sha of [...names].sort((a, b) => history.indexOf(a) - history.indexOf(b))) {
    const parents = git(dir, 'show', '-s', '--format=%P', sha).split(' ');
    git(dir, 'revert', '--no-commit', ...(parents.length > 1 ? ['-m', '1'] : []), sha);
  }
  if (git(dir, 'write-tree') !== git(dir, 'rev-parse', `${headSha}^{tree}`))
    throw new Error('Recovery tree differs from the exact revert');
}

export const repo = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY is required');
export const api = (path, payload, method) => {
  const verb = method ?? (payload ? 'POST' : undefined);
  const output = execFileSync(
    'gh',
    ['api', path, ...(verb ? ['--method', verb] : []), ...(payload ? ['--input', '-'] : [])],
    {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      ...(payload ? { input: JSON.stringify(payload) } : {}),
    },
  );
  return output.trim() ? JSON.parse(output) : null;
};
export const pages = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', path, '--paginate', '--slurp'], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    }),
  );
export const markers = () =>
  pages(`repos/${repo}/issues?state=open&labels=autonomy-paused&per_page=100`)
    .flat()
    .filter((issue) => !issue.pull_request);

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
  const names = revertedShas(commits[0].commit.message);
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
    assertExactRevertTree(dir, {
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      names,
      history,
    });
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
  const path = `repos/${repo}/statuses/${pr.head.sha}`;
  const payload = {
    context: 'autonomy-brake',
    state: allowed ? 'success' : 'failure',
    description: allowed ? 'Autonomy brake permits this head' : 'Autonomous merging is paused',
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      api(path, payload);
      break;
    } catch (error) {
      if (attempt < 3 && /^unexpected end of JSON input$/m.test(String(error.stderr))) continue;
      throw new Error(
        `Status publication failed for ${path} after ${attempt} attempt(s): ${error.message}`,
        { cause: error },
      );
    }
  }
  return allowed;
}

export function disarmAutoMerge(pr) {
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
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    ),
  );
  if (result.errors || !result.data?.disablePullRequestAutoMerge)
    throw new Error('Disarm mutation failed');
}

function sweep(paused) {
  let failed = false;
  for (const pr of pages(`repos/${repo}/pulls?state=open&per_page=100`).flat()) {
    const errors = [];
    let allowed = !paused;
    let published = false;
    try {
      allowed = checkPull(pr, paused);
      published = true;
    } catch (error) {
      errors.push(error);
    }
    try {
      if (!allowed && pr.auto_merge) {
        disarmAutoMerge(pr);
        console.log(`#${pr.number}: disarmed`);
      }
    } catch (error) {
      errors.push(error);
    }
    try {
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
      if (latest?.status === 'completed') {
        try {
          api(`repos/${repo}/actions/runs/${latest.id}/rerun`, {});
        } catch (error) {
          if (!/This workflow is already running \(HTTP 403\)/.test(String(error.stderr)))
            throw error;
          const current = api(`repos/${repo}/actions/runs/${latest.id}`);
          if (
            current.id !== latest.id ||
            current.head_sha !== pr.head.sha ||
            !current.pull_requests?.some((pull) => pull.number === pr.number) ||
            !['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(current.status)
          )
            throw error;
        }
      }
    } catch (error) {
      errors.push(error);
    }
    if (!paused && published) {
      try {
        requeueBrakeDequeue(pr);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      failed = true;
      for (const error of errors) console.error(error.message);
      console.log(`#${pr.number}: failed`);
    }
  }
  if (failed) process.exitCode = 1;
}

const autoResumeMarker = '<!-- autonomy-brake: auto-resume -->';
const mergifyStart = '-*- Mergify Payload -*-';
const mergifyEnd = '-*- Mergify Payload End -*-';

function mergifyState(body) {
  const start = body?.indexOf(mergifyStart) ?? -1;
  const end = body?.indexOf(mergifyEnd) ?? -1;
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(body.slice(start + mergifyStart.length, end).trim());
  } catch {
    return null;
  }
}

function rerunFailed(runId, sha) {
  if (!/^[1-9]\d*$/.test(runId ?? '')) throw new Error('A run id is required');
  if (!shaPattern.test(sha ?? '')) throw new Error('Invalid SHA');
  const current = api(`repos/${repo}/actions/runs/${runId}`);
  if (current.head_sha !== sha) throw new Error('Run SHA mismatch');
  if (current.conclusion === 'success') {
    console.log(`autonomy: run ${runId} already succeeded`);
    return;
  }
  if (Number(current.run_attempt) > 1) {
    if (current.status !== 'completed') {
      console.log(`autonomy: run ${runId} attempt ${current.run_attempt} still running`);
      return;
    }
    throw new Error(`Run ${runId} attempt ${current.run_attempt} failed`);
  }
  const mainSha = api(`repos/${repo}/branches/main`).commit?.sha;
  if (!shaPattern.test(mainSha ?? '')) throw new Error('Main SHA is missing');
  if (mainSha !== sha) {
    console.log(`autonomy: not rerunning ${runId}; main is ${mainSha}`);
    return;
  }
  try {
    execFileSync('gh', ['run', 'rerun', runId, '--failed', '--repo', repo], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(String(error.stderr || error.message).trim(), { cause: error });
  }
  console.log(`autonomy: reran failed jobs of ${runId}`);
}

function requeueBrakeDequeue(pr) {
  if (!pr.labels?.some((label) => label.name === 'dequeued')) return;
  const comments = pages(`repos/${repo}/issues/${pr.number}/comments?per_page=100`).flat();
  let latest;
  for (const comment of comments) {
    if (comment.user?.login !== 'mergify[bot]') continue;
    const state = mergifyState(comment.body);
    if (state === undefined) continue;
    latest = { state, created_at: comment.created_at };
  }
  const checks = latest?.state?.dequeue_reason?.checks;
  if (
    latest?.state?.state !== 'dequeued' ||
    latest.state.dequeue_reason?.code !== 'CHECKS_FAILED' ||
    !Array.isArray(checks) ||
    !checks.length ||
    checks.some((check) => check !== 'autonomy-brake')
  )
    return;
  const asked = comments.some(
    (comment) =>
      comment.body?.trim() === '@mergifyio requeue' &&
      latest.created_at &&
      comment.created_at >= latest.created_at,
  );
  if (!asked) api(`repos/${repo}/issues/${pr.number}/comments`, { body: '@mergifyio requeue' });
  try {
    api(`repos/${repo}/issues/${pr.number}/labels/dequeued`, undefined, 'DELETE');
  } catch (error) {
    if (!/HTTP 404/.test(`${error.stderr ?? ''}\n${error.message}`)) throw error;
  }
  console.log(`#${pr.number}: requeued`);
}

function resume() {
  const open = markers();
  if (!open.length) {
    console.log('autonomy: no marker');
    return;
  }
  const main = api(`repos/${repo}/branches/main`).commit.sha;
  const latest = api(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&per_page=1`)
    .workflow_runs?.[0];
  if (
    latest?.status !== 'completed' ||
    latest.conclusion !== 'success' ||
    latest.head_sha !== main
  ) {
    console.log(
      `autonomy: still paused (latest main ci ${latest ? `${latest.conclusion ?? latest.status} at ${latest.head_sha}` : 'missing'}, main ${main})`,
    );
    return;
  }
  for (const issue of open) {
    if (!String(issue.body ?? '').includes(autoResumeMarker)) {
      console.log(`#${issue.number}: manual marker kept`);
      continue;
    }
    api(`repos/${repo}/issues/${issue.number}/comments`, {
      body: `Main CI is green again at ${main} (${latest.html_url}). Resuming autonomous merging.`,
    });
    api(`repos/${repo}/issues/${issue.number}`, { state: 'closed' }, 'PATCH');
    console.log(`#${issue.number}: resumed`);
  }
  sweep(markers().length > 0);
  console.log(`autonomy: ${markers().length > 0 ? 'paused' : 'resumed'}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
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
          body: `${reason}\n\n${autoResumeMarker}\n\nClose this issue to resume autonomous merging.`,
          labels: ['autonomy-paused'],
        });
      }
      sweep(true);
      console.log('autonomy: paused');
    } else if (command === 'sweep') sweep(markers().length > 0);
    else if (command === 'resume') resume();
    else if (command === 'check-pr') {
      if (!/^[1-9]\d*$/.test(args[0] ?? '')) throw new Error('A PR number is required');
      const pr = api(`repos/${repo}/pulls/${args[0]}`);
      if (!checkPull({ ...pr, number: Number(args[0]) }, markers().length > 0))
        throw new Error('autonomy-paused: autonomous merging is paused');
    } else if (command === 'verify-recovery') verifyRecovery(args[0]);
    else if (command === 'rerun-failed') {
      const runAt = args.indexOf('--run');
      const shaAt = args.indexOf('--sha');
      rerunFailed(runAt >= 0 ? args[runAt + 1] : '', shaAt >= 0 ? args[shaAt + 1] : '');
    } else
      throw new Error(
        'Expected status, pause, resume, sweep, check-pr, verify-recovery, or rerun-failed',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

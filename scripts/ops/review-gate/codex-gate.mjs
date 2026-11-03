import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  decide,
  GATE_CHECK,
  retryStatus,
  STALL_LABEL,
  shouldSkip,
  trustedStateComment,
  usageLimitHit,
} from './codex-gate-core.mjs';

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          isResolved
          isOutdated
          comments(first: 1) { nodes { author { login __typename } body url } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

const ghJson = (args) => JSON.parse(gh(args));
const ghWrite = (method, path, payload) =>
  gh(['api', '--method', method, path, '--input', '-'], JSON.stringify(payload ?? {}));

function listPaged(path) {
  return JSON.parse(gh(['api', '--paginate', '--slurp', `${path}?per_page=100`])).flat();
}

function loadThreads(repo, number) {
  const [owner, name] = repo.split('/');
  const threads = [];
  let cursor = null;
  for (;;) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${THREADS_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${number}`,
    ];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const page = ghJson(args).data.repository.pullRequest.reviewThreads;
    for (const node of page.nodes) {
      const first = node.comments.nodes[0];
      threads.push({
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        authorLogin: first?.author?.login ?? '',
        authorType: first?.author?.__typename ?? '',
        body: first?.body ?? '',
        url: first?.url ?? '',
      });
    }
    if (!page.pageInfo.hasNextPage) return threads;
    cursor = page.pageInfo.endCursor;
  }
}

function writeCheck(repo, sha, result, detailsUrl) {
  const runs = ghJson([
    'api',
    `repos/${repo}/commits/${sha}/check-runs?check_name=${GATE_CHECK}&filter=latest&per_page=100`,
  ]).check_runs.filter((run) => run.app?.slug === 'github-actions');
  const newest = runs.reduce(
    (latest, run) =>
      !latest ||
      Date.parse(run.started_at) > Date.parse(latest.started_at) ||
      (run.started_at === latest.started_at && run.id > latest.id)
        ? run
        : latest,
    null,
  );
  const payload = {
    name: GATE_CHECK,
    head_sha: sha,
    status: result.status,
    output: { title: result.title, summary: result.summary },
    ...(result.conclusion ? { conclusion: result.conclusion } : {}),
    ...(detailsUrl ? { details_url: detailsUrl } : {}),
  };
  if (newest) ghWrite('PATCH', `repos/${repo}/check-runs/${newest.id}`, payload);
  else ghWrite('POST', `repos/${repo}/check-runs`, payload);
}

function evaluate(repo, number) {
  const pr = ghJson(['api', `repos/${repo}/pulls/${number}`]);
  const skip = shouldSkip(pr);
  if (skip) {
    console.log(`skipping PR #${number}: ${skip}`);
    return;
  }
  const sha = pr.head.sha;
  const comments = listPaged(`repos/${repo}/issues/${number}/comments`);
  const stateEntry = trustedStateComment(comments);
  const threads = loadThreads(repo, number);
  const retries = retryStatus(comments, sha, stateEntry?.comment.updated_at ?? null);
  const result = decide(
    pr,
    stateEntry?.state ?? null,
    threads,
    retries,
    usageLimitHit(comments, stateEntry),
  );
  console.log(
    `PR #${number} ${sha.slice(0, 7)}: ${result.status} ${result.conclusion ?? ''} ${result.title}`,
  );

  if (result.retry)
    ghWrite('POST', `repos/${repo}/issues/${number}/comments`, {
      body: `${result.retry}\n@codex review`,
    });
  writeCheck(repo, sha, result, stateEntry?.comment.html_url);

  const stalled = pr.labels.some((label) => label.name === STALL_LABEL);
  if (result.addStall && !stalled)
    ghWrite('POST', `repos/${repo}/issues/${number}/labels`, { labels: [STALL_LABEL] });
  if (result.removeStall && stalled)
    ghWrite('DELETE', `repos/${repo}/issues/${number}/labels/${STALL_LABEL}`);
}

function main(argv, env) {
  if (argv[0] !== 'evaluate') throw new Error('usage: codex-gate.mjs evaluate');
  for (const key of ['GH_TOKEN', 'REPO', 'PR_NUMBER'])
    if (!env[key]) throw new Error(`${key} is required`);
  evaluate(env.REPO, Number(env.PR_NUMBER));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

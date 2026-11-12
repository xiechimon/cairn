import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ACTIONS_LOGIN,
  attemptStart,
  BLOCK_ROUND_CAP,
  blockingThreads,
  blockRounds,
  carriedMarker,
  decide,
  deferredIssue,
  deferredThreads,
  GATE_CHECK,
  HUMAN_LABEL,
  lastBlockedSha,
  markDeferrals,
  markPreExisting,
  preExistingThreads,
  retryStatus,
  reviewRequested,
  STALL_LABEL,
  shouldSkip,
  trustedStateComment,
  usageLimitHit,
  writerReplies,
} from './codex-gate-core.mjs';

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          isResolved
          isOutdated
          path
          line
          startLine
          diffSide
          comments(first: 100) { totalCount nodes { author { login __typename } authorAssociation body url pullRequestReview { body } } }
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
      const [first, ...replies] = node.comments.nodes;
      if (
        Number.isInteger(node.comments.totalCount) &&
        node.comments.totalCount > node.comments.nodes.length
      )
        throw new Error('A review thread has more comments than one page');
      threads.push({
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        path: node.path,
        line: node.line,
        startLine: node.startLine,
        diffSide: node.diffSide,
        authorLogin: first?.author?.login ?? '',
        authorType: first?.author?.__typename ?? '',
        body: first?.body ?? '',
        reviewBody: first?.pullRequestReview?.body ?? '',
        url: first?.url ?? '',
        replies: writerReplies(replies),
      });
    }
    if (!page.pageInfo.hasNextPage) return threads;
    cursor = page.pageInfo.endCursor;
  }
}

function issueKind(repo, number) {
  try {
    const text = execFileSync('gh', ['api', '-i', `repos/${repo}/issues/${number}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const body = JSON.parse(text.slice(text.search(/\r?\n\r?\n/)).trim());
    return body.pull_request ? 'pull' : 'issue';
  } catch (error) {
    if (/^HTTP\/[\d.]+ (404|410)\b/.test(String(error.stdout ?? ''))) return 'missing';
    throw error;
  }
}

function loadIssueKinds(repo, threads) {
  const numbers = new Set(deferredThreads(threads).map(deferredIssue));
  return new Map([...numbers].map((number) => [number, issueKind(repo, number)]));
}

function loadFiles(repo, pr) {
  const metadata = Number.isSafeInteger(pr.changed_files)
    ? pr
    : ghJson(['api', `repos/${repo}/pulls/${pr.number}`]);
  const files = listPaged(`repos/${repo}/pulls/${pr.number}/files`);
  if (
    metadata.head.sha !== pr.head.sha ||
    !Number.isSafeInteger(metadata.changed_files) ||
    metadata.changed_files < 0 ||
    files.length !== metadata.changed_files ||
    !files.every(
      (file) =>
        typeof file?.filename === 'string' &&
        (file.previous_filename === undefined || typeof file.previous_filename === 'string'),
    )
  ) {
    throw new Error('The PR file list is incomplete or malformed');
  }
  return files;
}

function newestOwnCheck(repo, sha) {
  const runs = ghJson([
    'api',
    `repos/${repo}/commits/${sha}/check-runs?check_name=${GATE_CHECK}&filter=latest&per_page=100`,
  ]).check_runs.filter((run) => run.app?.slug === 'github-actions');
  return runs.reduce(
    (latest, run) =>
      !latest ||
      Date.parse(run.started_at) > Date.parse(latest.started_at) ||
      (run.started_at === latest.started_at && run.id > latest.id)
        ? run
        : latest,
    null,
  );
}

function writeCheck(repo, sha, newest, result, detailsUrl) {
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

function loadSinceFiles(repo, base, head) {
  if (!/^[0-9a-f]{40}$/.test(base ?? '') || !/^[0-9a-f]{40}$/.test(head)) return null;
  try {
    const comparison = ghJson(['api', `repos/${repo}/compare/${base}...${head}`]);
    const files = comparison.files;
    if (
      comparison.behind_by !== 0 ||
      !Array.isArray(files) ||
      files.length >= 300 ||
      !files.every(
        (file) =>
          file &&
          typeof file.filename === 'string' &&
          (file.patch == null || typeof file.patch === 'string') &&
          (file.previous_filename == null || typeof file.previous_filename === 'string'),
      )
    ) {
      console.error('review-gate: compare is not a straight-line diff; round 3 keeps blocking');
      return null;
    }
    return files;
  } catch (error) {
    console.error(`review-gate: compare failed; round 3 keeps blocking (${error.message})`);
    return null;
  }
}

function evaluate(repo, number) {
  const pr = ghJson(['api', `repos/${repo}/pulls/${number}`]);
  const skip = shouldSkip(pr);
  if (skip) {
    console.log(`skipping PR #${number}: ${skip}`);
    return;
  }
  const sha = pr.head.sha;
  const check = newestOwnCheck(repo, sha);
  let files;
  let comments;
  let loaded;
  let issueKinds;
  try {
    files = loadFiles(repo, pr);
    comments = listPaged(`repos/${repo}/issues/${number}/comments`);
    loaded = loadThreads(repo, number);
    issueKinds = loadIssueKinds(repo, loaded);
  } catch (error) {
    console.error(error.message);
    writeCheck(repo, sha, check, {
      status: 'completed',
      conclusion: 'failure',
      title: 'Cannot determine the review inputs',
      summary:
        'The PR file list or review inputs could not be verified. Re-evaluate after the complete file list and review threads are available; a previous successful check cannot qualify this head.',
    });
    return;
  }
  const stateEntry = trustedStateComment(comments);
  const hasFindings =
    blockingThreads(loaded).length + preExistingThreads(loaded).length + issueKinds.size > 0;
  const threads = markDeferrals(hasFindings ? markPreExisting(loaded, files) : loaded, issueKinds);
  const retries = retryStatus(comments, sha, stateEntry?.comment ?? null);
  const start = attemptStart(comments, stateEntry, sha);
  const lastActivity = Math.max(check ? Date.parse(check.started_at) : 0, start?.time ?? 0);
  const rounds = blockRounds(comments, sha);
  const reviewed = stateEntry?.state?.commitSha === sha && stateEntry.state.status === 'completed';
  const sinceFiles =
    reviewed && rounds.others + 1 >= BLOCK_ROUND_CAP
      ? loadSinceFiles(repo, lastBlockedSha(comments, sha), sha)
      : null;
  const result = decide(
    pr,
    stateEntry?.state ?? null,
    threads,
    retries,
    usageLimitHit(comments, stateEntry, sha),
    {
      waitedMs: check ? Date.now() - Date.parse(check.started_at) : 0,
      requested: reviewRequested(comments, sha),
      sinceRequestMs: start ? Date.now() - start.time : 0,
      idleMs: lastActivity > 0 ? Date.now() - lastActivity : 0,
    },
    { ...rounds, sinceFiles },
  );
  console.log(
    `PR #${number} ${sha.slice(0, 7)}: ${result.status} ${result.conclusion ?? ''} ${result.title}`,
  );

  const marker = result.retry ?? result.request;
  if (marker)
    ghWrite('POST', `repos/${repo}/issues/${number}/comments`, {
      body: `${marker}\n@codex review`,
    });
  if (result.addHuman && !pr.labels.some((label) => label.name === HUMAN_LABEL))
    ghWrite('POST', `repos/${repo}/issues/${number}/labels`, { labels: [HUMAN_LABEL] });
  if (result.block)
    ghWrite('POST', `repos/${repo}/issues/${number}/comments`, {
      body: `${result.block}\nReview-gate: ${result.title}`,
    });
  if (
    result.carried &&
    !comments.some(
      (comment) =>
        comment.user?.login === ACTIONS_LOGIN && comment.body?.startsWith(carriedMarker(sha)),
    )
  )
    ghWrite('POST', `repos/${repo}/issues/${number}/comments`, { body: result.carried });
  writeCheck(repo, sha, check, result, stateEntry?.comment.html_url);

  const stalled = pr.labels.some((label) => label.name === STALL_LABEL);
  if (result.addStall && !stalled)
    ghWrite('POST', `repos/${repo}/issues/${number}/labels`, { labels: [STALL_LABEL] });
  if (result.removeStall && stalled)
    ghWrite('DELETE', `repos/${repo}/issues/${number}/labels/${STALL_LABEL}`);
}

const GATE_WORKFLOW = 'review-gate.yml';

function sweep(repo) {
  const open = listPaged(`repos/${repo}/pulls`).filter((pr) => !pr.draft);
  let failed = 0;
  for (const pr of open) {
    try {
      const check = newestOwnCheck(repo, pr.head.sha);
      if (check?.status === 'completed' && check.conclusion === 'success') continue;
      ghWrite('POST', `repos/${repo}/actions/workflows/${GATE_WORKFLOW}/dispatches`, {
        ref: 'main',
        inputs: { pr: String(pr.number) },
      });
    } catch (error) {
      failed += 1;
      console.error(`PR #${pr.number}: ${error.message}`);
    }
  }
  if (failed) throw new Error(`${failed} of ${open.length} PRs could not be evaluated`);
}

function main(argv, env) {
  const command = argv[0];
  if (command !== 'evaluate' && command !== 'sweep')
    throw new Error('usage: codex-gate.mjs evaluate|sweep');
  const required =
    command === 'evaluate' ? ['GH_TOKEN', 'REPO', 'PR_NUMBER'] : ['GH_TOKEN', 'REPO'];
  for (const key of required) if (!env[key]) throw new Error(`${key} is required`);
  if (command === 'sweep') sweep(env.REPO);
  else evaluate(env.REPO, Number(env.PR_NUMBER));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

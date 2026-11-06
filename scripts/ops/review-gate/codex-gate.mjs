import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  blockingThreads,
  blockRounds,
  decide,
  GATE_CHECK,
  HUMAN_LABEL,
  markPreExisting,
  preExistingThreads,
  receiptCommit,
  requiresSecurityReview,
  retryStatus,
  reviewRequested,
  STALL_LABEL,
  securityReceiptComment,
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
          path
          line
          startLine
          diffSide
          comments(first: 1) { nodes { author { login __typename } body url pullRequestReview { body } } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const FORCE_PUSH_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      timelineItems(first: 100, after: $cursor, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
        nodes { ... on HeadRefForcePushedEvent { createdAt } }
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
        path: node.path,
        line: node.line,
        startLine: node.startLine,
        diffSide: node.diffSide,
        authorLogin: first?.author?.login ?? '',
        authorType: first?.author?.__typename ?? '',
        body: first?.body ?? '',
        reviewBody: first?.pullRequestReview?.body ?? '',
        url: first?.url ?? '',
      });
    }
    if (!page.pageInfo.hasNextPage) return threads;
    cursor = page.pageInfo.endCursor;
  }
}

function loadForcePushes(repo, number) {
  const [owner, name] = repo.split('/');
  const events = [];
  let cursor = null;
  for (;;) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${FORCE_PUSH_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${number}`,
    ];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const page = ghJson(args).data.repository.pullRequest.timelineItems;
    events.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return events;
    if (typeof page.pageInfo.endCursor !== 'string' || page.pageInfo.endCursor === cursor)
      throw new Error('Incomplete force-push timeline');
    cursor = page.pageInfo.endCursor;
  }
}

function loadReceiptEvidence(repo, pr, comments, state) {
  if (
    state?.commitSha !== pr.head.sha ||
    state.status !== 'completed' ||
    state.hasUnresolvedFindings !== null
  )
    return null;
  const prefix = receiptCommit(securityReceiptComment(comments));
  if (!prefix || !pr.head.sha.startsWith(prefix)) return null;
  try {
    const commits = listPaged(`repos/${repo}/pulls/${pr.number}/commits`).map(
      (commit) => commit.sha,
    );
    const resolvedSha = ghJson(['api', `repos/${repo}/commits/${prefix}`]).sha;
    const forcePushes = loadForcePushes(repo, pr.number);
    const refMatches =
      prefix.length === 40
        ? []
        : ['heads', 'tags'].flatMap((kind) =>
            listPaged(`repos/${repo}/git/matching-refs/${kind}/${prefix}`).map((ref) => ref.ref),
          );
    return { comments, commits, resolvedSha, forcePushes, refMatches };
  } catch (error) {
    console.error(`PR #${pr.number}: cannot prove security receipt provenance: ${error.message}`);
    return null;
  }
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
  try {
    files = loadFiles(repo, pr);
    comments = listPaged(`repos/${repo}/issues/${number}/comments`);
    loaded = loadThreads(repo, number);
  } catch (error) {
    console.error(error.message);
    writeCheck(repo, sha, check, {
      status: 'completed',
      conclusion: 'failure',
      title: 'Cannot determine the required security review',
      summary:
        'The PR file list or review inputs could not be verified. Re-evaluate after the complete file list and review threads are available; a previous successful check cannot qualify this head.',
    });
    return;
  }
  const stateEntry = trustedStateComment(comments);
  const hasFindings = blockingThreads(loaded).length + preExistingThreads(loaded).length > 0;
  const threads = hasFindings ? markPreExisting(loaded, files) : loaded;
  const retries = retryStatus(comments, sha, stateEntry?.comment.updated_at ?? null);
  const needsSecurity = requiresSecurityReview(files);
  const securityEntry = needsSecurity ? trustedStateComment(comments, 'security_review') : null;
  const security = needsSecurity
    ? {
        state: securityEntry?.state ?? null,
        receiptEvidence: loadReceiptEvidence(repo, pr, comments, securityEntry?.state),
      }
    : null;
  const result = decide(
    pr,
    stateEntry?.state ?? null,
    threads,
    retries,
    usageLimitHit(comments, stateEntry),
    {
      waitedMs: check ? Date.now() - Date.parse(check.started_at) : 0,
      requested: reviewRequested(comments, sha),
    },
    blockRounds(comments, sha),
    security,
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
  writeCheck(repo, sha, check, result, stateEntry?.comment.html_url);
  if (result.conclusion === 'failure' && pr.labels.some((label) => label.name === QUEUED_LABEL))
    ghWrite('POST', `repos/${repo}/issues/${number}/comments`, { body: '@mergifyio dequeue' });

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
      if (check?.status === 'completed' && check.conclusion === 'success') {
        try {
          if (!requiresSecurityReview(loadFiles(repo, pr))) continue;
        } catch (error) {
          console.error(`PR #${pr.number}: ${error.message}; re-evaluating the check`);
        }
      }
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

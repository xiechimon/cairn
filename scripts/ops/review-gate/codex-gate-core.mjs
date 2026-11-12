import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

export const CODEX_LOGIN = 'chatgpt-codex-connector';
export const ACTIONS_LOGIN = 'github-actions[bot]';
export const GATE_CHECK = 'review-gate';
export const STALL_LABEL = 'review-stalled';
export const HUMAN_LABEL = 'review-gate-human';
export const BLOCK_ROUND_CAP = 3;
export const MAX_RETRIES = 2;
export const REQUEST_AFTER_MS = 10 * 60 * 1000;
export const WAIT_DEADLINE_MS = 30 * 60 * 1000;
export const LIMIT_RETRY_AFTER_MS = 2 * 60 * 60 * 1000;
export const USAGE_DASHBOARD = 'https://chatgpt.com/codex/cloud/settings/usage';

const gatePaths = JSON.parse(
  readFileSync(new URL('../../../packages/shared/merge-gate-paths.json', import.meta.url), 'utf8'),
);
const securityPatterns = ['credentials', 'machineAndCommandBoundary', 'externalEntryAuth'].flatMap(
  (category) => gatePaths.humanQueue[category],
);

export function requiresSecurityReview(files) {
  return files.some((file) =>
    [file.filename, file.previous_filename].some(
      (path) =>
        typeof path === 'string' && securityPatterns.some((pattern) => matchesGlob(path, pattern)),
    ),
  );
}

const STATE_RE = /<!-- codex-review-state:v1 (\{.*?\}) -->/s;
const BADGE_RE = /^\s*\*\*<sub><sub>!\[(P[0-3]) Badge\]/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const BLOCK_MARKER_RE = /^<!-- review-gate-block:([0-9a-f]+) -->/;
const LIMIT_RE = /reached your Codex usage limits/i;
const DEFERRAL_RE = /^\s*valid, out of scope for this PR, tracked in #(\d+)\b/im;
const BLOCKING = new Set(['P0', 'P1']);
const WRITE_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MERGE_QUEUE_PREFIX = 'mergify/merge-queue/';
const short = (sha) => sha.slice(0, 7);
const stripBot = (login) => String(login ?? '').replace(/\[bot\]$/, '');

export function parseState(body, kind = 'code_review') {
  const match = STATE_RE.exec(body ?? '');
  if (!match) return null;
  try {
    const review = JSON.parse(match[1])[kind];
    if (!review || typeof review !== 'object') return null;
    return {
      commitSha: review.commit_sha ?? null,
      status: review.status ?? null,
      ...(kind === 'security_review'
        ? { hasUnresolvedFindings: review.has_unresolved_findings }
        : {}),
    };
  } catch {
    return null;
  }
}

export function isCodexAuthor(login, type) {
  return type === 'Bot' && stripBot(login) === CODEX_LOGIN;
}

export function trustedStateComment(comments, kind = 'code_review') {
  const trusted = comments
    .filter((comment) => isCodexAuthor(comment.user?.login, comment.user?.type))
    .flatMap((comment) => {
      const state = parseState(comment.body, kind);
      return state || (kind === 'security_review' && STATE_RE.test(comment.body ?? ''))
        ? [{ comment, state }]
        : [];
    });
  return trusted.reduce(
    (latest, entry) =>
      !latest ||
      stampOrder(stampOf(entry.comment, 'updated_at'), stampOf(latest.comment, 'updated_at')) >= 0
        ? entry
        : latest,
    null,
  );
}

const idOf = (comment) => (Number.isFinite(Number(comment.id)) ? Number(comment.id) : 0);

export function stampOf(comment, field = 'created_at') {
  return { time: Date.parse(comment[field]), id: idOf(comment) };
}

export function stampOrder(a, b) {
  return a.time - b.time || a.id - b.id;
}

const latestStamp = (stamps) =>
  stamps.reduce(
    (latest, stamp) => (!latest || stampOrder(stamp, latest) > 0 ? stamp : latest),
    null,
  );

const gateRequestStamps = (comments, sha) => {
  const prefixes = [`<!-- review-gate-request:${sha} -->`, `<!-- review-gate-retry:${sha}:`];
  return comments
    .filter(
      (comment) =>
        comment.user?.login === ACTIONS_LOGIN &&
        prefixes.some((prefix) => comment.body?.startsWith(prefix)),
    )
    .map((comment) => stampOf(comment));
};

export function attemptStart(comments, stateEntry, sha) {
  const stamps = gateRequestStamps(comments, sha);
  if (stateEntry?.state?.commitSha === sha) stamps.push(stampOf(stateEntry.comment, 'updated_at'));
  return latestStamp(stamps);
}

export function usageLimitHit(comments, stateEntry, sha) {
  const newest = comments
    .filter((comment) => isCodexAuthor(comment.user?.login, comment.user?.type))
    .reduce(
      (latest, comment) =>
        !latest || stampOrder(stampOf(comment), stampOf(latest)) >= 0 ? comment : latest,
      null,
    );
  if (!newest || !LIMIT_RE.test(newest.body ?? '')) return false;
  const start = attemptStart(comments, stateEntry, sha);
  return start !== null && stampOrder(stampOf(newest), start) > 0;
}

export function badgeOf(body) {
  return BADGE_RE.exec(body ?? '')?.[1] ?? null;
}

export function threadTitle(body) {
  for (const line of (body ?? '').split('\n')) {
    const text = line
      .replace(/<\/?sub>/g, '')
      .replace(/!\[P[0-3] Badge\]\([^)]*\)/g, '')
      .replace(/\*\*/g, '')
      .trim();
    if (text) return text;
  }
  return '';
}

export function touchedLinesOf(patch) {
  const touched = new Set();
  let hunkLines = [];
  let hunkAdded = [];
  let removed = false;
  let line = 0;
  const closeHunk = () => {
    for (const touchedLine of removed ? hunkLines : hunkAdded) touched.add(touchedLine);
    hunkLines = [];
    hunkAdded = [];
    removed = false;
  };
  for (const text of String(patch ?? '').split('\n')) {
    const hunk = HUNK_RE.exec(text);
    if (hunk) {
      closeHunk();
      line = Number(hunk[1]);
    } else if (text.startsWith('+')) {
      hunkLines.push(line);
      hunkAdded.push(line++);
    } else if (text.startsWith(' ')) {
      hunkLines.push(line++);
    } else if (text.startsWith('-')) {
      removed = true;
    }
  }
  closeHunk();
  return touched;
}

export function markPreExisting(threads, files) {
  const touchedByPath = new Map(
    files.map((file) => [file.filename, file.patch ? touchedLinesOf(file.patch) : null]),
  );
  return threads.map((thread) => {
    const touched = touchedByPath.get(thread.path);
    const last = thread.line;
    const first = thread.startLine ?? last;
    const settled =
      !thread.isOutdated && thread.diffSide === 'RIGHT' && Number.isInteger(last) && touched;
    if (!settled) return thread;
    for (let line = first; line <= last; line += 1) if (touched.has(line)) return thread;
    return { ...thread, preExisting: true };
  });
}

const openCodexFindings = (threads) =>
  threads.filter(
    (thread) =>
      !thread.isResolved &&
      isCodexAuthor(thread.authorLogin, thread.authorType) &&
      BLOCKING.has(badgeOf(thread.body)),
  );

export function blockingThreads(threads) {
  return openCodexFindings(threads).filter((thread) => !thread.preExisting);
}

export function preExistingThreads(threads) {
  return openCodexFindings(threads).filter((thread) => thread.preExisting);
}

export function writerReplies(comments) {
  return comments
    .filter(
      (comment) =>
        WRITE_ASSOCIATIONS.has(comment?.authorAssociation) ||
        (comment?.author?.__typename === 'Bot' && stripBot(comment.author.login) === 'cairnwright'),
    )
    .map((comment) => comment.body ?? '');
}

export function deferredIssue(thread) {
  for (const body of [...(thread.replies ?? [])].reverse()) {
    const match = DEFERRAL_RE.exec(body ?? '');
    if (match) return Number(match[1]);
  }
  return null;
}

export function deferredThreads(threads) {
  return threads.filter(
    (thread) =>
      isCodexAuthor(thread.authorLogin, thread.authorType) && deferredIssue(thread) !== null,
  );
}

export function markDeferrals(threads, issueKinds) {
  const deferred = new Set(deferredThreads(threads));
  return threads.map((thread) => {
    if (!deferred.has(thread)) return thread;
    const number = deferredIssue(thread);
    if (BLOCKING.has(badgeOf(thread.body)) && !thread.preExisting)
      return { ...thread, deferral: `deferred to #${number}, but a P0/P1 finding must be fixed` };
    if (issueKinds.get(number) !== 'issue')
      return {
        ...thread,
        deferral: `deferred to #${number}, which is not an issue in this repository`,
      };
    return thread;
  });
}

export function blockMarker(sha) {
  return `<!-- review-gate-block:${sha} -->`;
}

export function blockRounds(comments, sha) {
  const heads = new Set();
  for (const comment of comments) {
    if (comment.user?.login !== ACTIONS_LOGIN) continue;
    const match = BLOCK_MARKER_RE.exec(comment.body ?? '');
    if (match) heads.add(match[1]);
  }
  return { others: heads.size - (heads.has(sha) ? 1 : 0), marked: heads.has(sha) };
}

export function lastBlockedSha(comments, sha) {
  let latest = null;
  for (const comment of comments) {
    if (comment.user?.login !== ACTIONS_LOGIN) continue;
    const match = BLOCK_MARKER_RE.exec(comment.body ?? '');
    if (!match || match[1] === sha) continue;
    const stamp = stampOf(comment);
    const ordered = Number.isFinite(stamp.time) ? stamp : { time: 0, id: stamp.id };
    if (!latest || stampOrder(ordered, latest.stamp) >= 0)
      latest = { sha: match[1], stamp: ordered };
  }
  return latest?.sha ?? null;
}

const currentAnchor = (thread) =>
  !thread.isOutdated &&
  thread.diffSide === 'RIGHT' &&
  typeof thread.path === 'string' &&
  Number.isInteger(thread.line);

function blocksOnNewDiff(thread, files) {
  if (badgeOf(thread.body) === 'P0') return true;
  const file = files.find(
    (item) => item.filename === thread.path || item.previous_filename === thread.path,
  );
  if (!currentAnchor(thread)) return Boolean(file);
  if (!file) return false;
  if (typeof file.patch !== 'string') return true;
  const touched = touchedLinesOf(file.patch);
  const last = thread.line;
  const first = thread.startLine ?? last;
  for (let line = first; line <= last; line += 1) if (touched.has(line)) return true;
  return false;
}

export function retryMarker(sha, k) {
  return `<!-- review-gate-retry:${sha}:${k} -->`;
}

export function retryStatus(comments, sha, stateComment) {
  const prefix = `<!-- review-gate-retry:${sha}:`;
  const mine = comments.filter(
    (comment) => comment.user?.login === ACTIONS_LOGIN && comment.body?.startsWith(prefix),
  );
  const last = latestStamp(mine.map((comment) => stampOf(comment)));
  return {
    count: mine.length,
    pending:
      last !== null &&
      Boolean(stateComment) &&
      stampOrder(last, stampOf(stateComment, 'updated_at')) > 0,
  };
}

export function requestMarker(sha) {
  return `<!-- review-gate-request:${sha} -->`;
}

export function reviewRequested(comments, sha) {
  const marker = requestMarker(sha);
  return comments.some(
    (comment) => comment.user?.login === ACTIONS_LOGIN && comment.body?.startsWith(marker),
  );
}

export function shouldSkip(pr) {
  if (pr.state !== 'open') return 'the PR is closed';
  if (pr.draft) return 'the PR is a draft';
  if (pr.head.ref.startsWith(MERGE_QUEUE_PREFIX)) return 'the head is a Mergify merge queue branch';
  if (!WRITE_ASSOCIATIONS.has(pr.author_association) && pr.user.login !== 'cairnwright[bot]')
    return 'the author has no write access';
  return null;
}

function blockedSummary(blocking, invalid) {
  const line = (thread) =>
    `- ${badgeOf(thread.body)} ${threadTitle(thread.body).replace(/^P[0-3]\s+/, '')}: ${thread.url}${
      thread.deferral ? ` (${thread.deferral})` : ''
    }`;
  return `Fix each P0/P1 finding, then resolve its thread. Only a P2/P3 finding may be answered \`valid, out of scope for this PR, tracked in #N\`, and #N must be an issue in this repository:\n\n${[
    ...blocking,
    ...invalid,
  ]
    .map(line)
    .join('\n')}`;
}

function carriedNote(carried) {
  if (carried.length === 0) return '';
  const lines = carried.map(
    (thread) =>
      `- ${badgeOf(thread.body)} ${threadTitle(thread.body).replace(/^P[0-3]\s+/, '')}: ${thread.url}`,
  );
  return `\n\nNot blocking, because the flagged lines predate this PR; file a follow-up issue instead:\n\n${lines.join('\n')}`;
}

export function carriedMarker(sha) {
  return `<!-- review-gate-carried:${sha} -->`;
}

function carriedListing(threads) {
  const lines = threads.map(
    (thread) =>
      `- ${badgeOf(thread.body)} ${threadTitle(thread.body)
        .replace(/^P[0-3]\s+/, '')
        .replace(/@/g, '')}: ${thread.url}`,
  );
  return `These findings are pre-existing in this PR, record in Risk:\n\n${lines.join('\n')}`;
}

function roundNote(round) {
  return `Review block round ${round} (cap ${BLOCK_ROUND_CAP}), reconsider the approach: stop fixing findings one line at a time. Name the bug class behind them, fix every instance, or change the approach; the PR is labelled \`${HUMAN_LABEL}\` for a human. From this round a P1 blocks only on lines changed since the last blocked head. Other open P1 threads are pre-existing in this PR, record in Risk. A P0 anywhere still blocks.`;
}

const SECURITY_RECEIPT_HEADER = /^#{2,3} (?:🛡️ )?Codex Security Review\s*$/m;
const SECURITY_FINDING =
  /<!-- codex-security-review-finding:v1 -->|^#{2,3} (?:🛡️ )?Codex Security Review\s*$/m;
const CLEAN_SECURITY =
  /^Security review completed\. No security issues were found in this pull request\.$/m;
const REVIEWED_COMMIT = /^\*\*Reviewed commit:\*\* `([0-9a-f]{7,40})`\s*$/gm;
const SECURITY_COMPLETION =
  /^\| 🔒 \*\*Security Review\*\* \| ✅ \*\*Completed\*\* <relative-time datetime="([^"]+)"/gm;
const RECEIPT_WINDOW_MS = 60_000;
const FULL_SHA = /^[0-9a-f]{40}$/;
const trustedTime = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    ? Date.parse(value)
    : Number.NaN;

export function securityReceiptComment(comments) {
  const receipts = comments.filter(
    (comment) =>
      isCodexAuthor(comment.user?.login, comment.user?.type) &&
      comment.body?.startsWith('<!-- codex-review-receipt:v1 -->') &&
      SECURITY_RECEIPT_HEADER.test(comment.body),
  );
  if (receipts.some((comment) => !Number.isFinite(trustedTime(comment.created_at)))) return null;
  return receipts.reduce(
    (latest, comment) =>
      !latest ||
      trustedTime(comment.created_at) > trustedTime(latest.created_at) ||
      (comment.created_at === latest.created_at && Number(comment.id) > Number(latest.id))
        ? comment
        : latest,
    null,
  );
}

export function receiptCommit(receipt) {
  const matches = [...String(receipt?.body ?? '').matchAll(REVIEWED_COMMIT)];
  return matches.length === 1 ? matches[0][1] : null;
}

export function securityThreads(threads) {
  return threads.filter(
    (thread) =>
      isCodexAuthor(thread.authorLogin, thread.authorType) &&
      (SECURITY_FINDING.test(thread.body ?? '') || SECURITY_FINDING.test(thread.reviewBody ?? '')),
  );
}

function securityThreadsClear(threads) {
  return (
    Array.isArray(threads) &&
    threads.every(
      (thread) =>
        thread &&
        (thread.isResolved === true ||
          (thread.isResolved === false &&
            typeof thread.authorLogin === 'string' &&
            thread.authorLogin.length > 0 &&
            ['Bot', 'User'].includes(thread.authorType) &&
            typeof thread.body === 'string')),
    ) &&
    securityThreads(threads).every((thread) => thread.isResolved === true)
  );
}

export function cleanSecurityReceipt(pr, evidence, threads) {
  if (
    !evidence ||
    !Array.isArray(evidence.comments) ||
    !Array.isArray(evidence.commits) ||
    !Array.isArray(evidence.forcePushes) ||
    !Array.isArray(evidence.refMatches)
  )
    return false;
  if (evidence.comments.some((comment) => !comment || typeof comment !== 'object')) return false;
  const entry = trustedStateComment(evidence.comments, 'security_review');
  if (
    entry?.state?.commitSha !== pr.head.sha ||
    entry.state.status !== 'completed' ||
    entry.state.hasUnresolvedFindings !== null
  )
    return false;
  const receipt = securityReceiptComment(evidence.comments);
  const prefix = receiptCommit(receipt);
  if (
    !receipt ||
    !prefix ||
    !CLEAN_SECURITY.test(receipt.body) ||
    !pr.head.sha.startsWith(prefix) ||
    evidence.resolvedSha !== pr.head.sha
  )
    return false;
  if (
    !evidence.refMatches.every(
      (ref) =>
        typeof ref === 'string' && ref !== `refs/heads/${prefix}` && ref !== `refs/tags/${prefix}`,
    )
  )
    return false;
  const commits = evidence.commits;
  if (
    !Number.isSafeInteger(pr.commits) ||
    pr.commits < 1 ||
    commits.length !== pr.commits ||
    !commits.every((sha) => typeof sha === 'string' && FULL_SHA.test(sha)) ||
    new Set(commits).size !== commits.length ||
    commits.filter((sha) => sha.startsWith(prefix)).length !== 1 ||
    !commits.includes(pr.head.sha)
  )
    return false;
  const completed = [...entry.comment.body.matchAll(SECURITY_COMPLETION)];
  if (completed.length !== 1) return false;
  const finishedAt = trustedTime(completed[0][1]);
  const createdAt = trustedTime(receipt.created_at);
  const updatedAt = trustedTime(receipt.updated_at);
  const summaryCreated = trustedTime(entry.comment.created_at);
  const summaryUpdated = trustedTime(entry.comment.updated_at);
  const prCreated = trustedTime(pr.created_at);
  if (
    ![finishedAt, createdAt, updatedAt, summaryCreated, summaryUpdated, prCreated].every(
      Number.isFinite,
    ) ||
    createdAt < prCreated ||
    createdAt < summaryCreated ||
    updatedAt < createdAt ||
    updatedAt > summaryUpdated ||
    finishedAt > summaryUpdated ||
    Math.abs(createdAt - finishedAt) > RECEIPT_WINDOW_MS
  )
    return false;
  for (const event of evidence.forcePushes) {
    const at = trustedTime(event?.createdAt);
    if (!Number.isFinite(at) || at >= createdAt) return false;
  }
  for (const comment of evidence.comments) {
    if (!/^@codex security review\s*$/m.test(comment.body ?? '')) continue;
    const at = trustedTime(comment.created_at);
    if (!Number.isFinite(at) || at >= createdAt) return false;
  }
  return securityThreadsClear(threads);
}

const NO_ROUNDS = { others: 0, marked: false };

export function decide(
  pr,
  state,
  threads,
  retries,
  limitHit = false,
  wait = null,
  rounds = NO_ROUNDS,
) {
  const sha = pr.head.sha;
  const reviewedHead = state?.commitSha === sha && state.status === 'completed';
  if (limitHit && !reviewedHead) {
    if (wait && wait.sinceRequestMs >= LIMIT_RETRY_AFTER_MS)
      return {
        status: 'in_progress',
        title: `Codex allowance exhausted; asked again for ${short(sha)}`,
        summary: `Codex had hit its usage limit for ${short(sha)} ${LIMIT_RETRY_AFTER_MS / 3600000} hours ago, so the gate commented \`@codex review\` again.`,
        retry: retryMarker(sha, retries.count + 1),
        addStall: true,
      };
    return {
      status: 'completed',
      conclusion: 'failure',
      title: 'Codex allowance exhausted',
      summary: `Codex reached its usage limit and did not review ${short(sha)}. See the [Codex usage dashboard](${USAGE_DASHBOARD}) and the gate asks again every ${LIMIT_RETRY_AFTER_MS / 3600000} hours.`,
      addStall: true,
    };
  }
  if (!state || state.commitSha !== sha || !state.status || state.status === 'running') {
    const unseen = !state || state.commitSha !== sha;
    if (unseen && wait && !wait.requested && wait.waitedMs >= REQUEST_AFTER_MS)
      return {
        status: 'in_progress',
        title: `Asked Codex to review ${short(sha)}`,
        summary: `Codex had not started a review of ${short(sha)} after ${REQUEST_AFTER_MS / 60000} minutes, so the gate commented \`@codex review\`.`,
        request: requestMarker(sha),
      };
    if (wait && wait.idleMs >= WAIT_DEADLINE_MS) {
      if (retries.count >= MAX_RETRIES)
        return {
          status: 'completed',
          conclusion: 'failure',
          title: 'Codex did not finish the review',
          summary: `Codex produced no result for ${short(sha)} after ${MAX_RETRIES} retries. Comment \`@codex review\` to try again.`,
          addStall: true,
        };
      return {
        status: 'in_progress',
        title: `Codex review stalled; retry ${retries.count + 1} of ${MAX_RETRIES}`,
        summary: `Codex produced no result for ${short(sha)} in ${WAIT_DEADLINE_MS / 60000} minutes, so the gate commented \`@codex review\` again.`,
        retry: retryMarker(sha, retries.count + 1),
      };
    }
    return {
      status: 'in_progress',
      title: `Waiting for the Codex review of ${short(sha)}`,
      summary: 'The Codex cloud review has not finished for this head yet.',
    };
  }
  if (state.status === 'failed') {
    if (retries.count >= MAX_RETRIES)
      return {
        status: 'completed',
        conclusion: 'failure',
        title: 'Codex review failed twice; comment `@codex review`',
        summary: `The Codex review failed ${MAX_RETRIES} times for ${short(sha)}. Comment \`@codex review\` to try again.`,
        addStall: true,
      };
    const pending = retries.pending && !(wait && wait.idleMs >= WAIT_DEADLINE_MS);
    const k = pending ? retries.count : retries.count + 1;
    return {
      status: 'in_progress',
      title: `Codex review failed; retry ${k} of ${MAX_RETRIES}`,
      summary: `Asked Codex to review ${short(sha)} again.`,
      ...(pending ? {} : { retry: retryMarker(sha, k) }),
    };
  }
  const open = blockingThreads(threads);
  const round = rounds.others + 1;
  const capped = round >= BLOCK_ROUND_CAP;
  const sinceFiles = Array.isArray(rounds.sinceFiles) ? rounds.sinceFiles : null;
  const narrowed = capped && sinceFiles !== null;
  const blocking = narrowed ? open.filter((thread) => blocksOnNewDiff(thread, sinceFiles)) : open;
  const carriedRound = narrowed ? open.filter((thread) => !blocking.includes(thread)) : [];
  const invalid = threads.filter(
    (thread) => thread.deferral && !blocking.includes(thread) && !carriedRound.includes(thread),
  );
  const carried = carriedNote(preExistingThreads(threads));
  const blockedHeads = rounds.others + (rounds.marked ? 1 : 0);
  const human = capped && !rounds.marked ? { addHuman: true } : {};
  const record =
    carriedRound.length > 0
      ? { carried: `${carriedMarker(sha)}\n${carriedListing(carriedRound)}` }
      : {};
  if (blocking.length === 0 && invalid.length === 0)
    return {
      status: 'completed',
      conclusion: 'success',
      summary: `${
        carriedRound.length > 0
          ? 'Codex reviewed this head. Open P1 threads on lines unchanged since the last blocked head do not block.'
          : 'Codex reviewed this head and no unresolved P0 or P1 thread remains.'
      }${
        blockedHeads > 0 ? ` Cycles to pass: ${blockedHeads} blocked head(s) before this one.` : ''
      }${carried}${narrowed ? `\n\n${roundNote(round)}` : ''}${
        carriedRound.length > 0 ? `\n\n${carriedListing(carriedRound)}` : ''
      }`,
      title:
        carriedRound.length > 0
          ? `No blocking P0/P1 on the new diff; round ${round}, reconsider the approach`
          : `No open P0/P1 Codex findings for ${short(sha)}`,
      removeStall: true,
      ...human,
      ...record,
    };
  const counts = [
    blocking.length > 0 ? `${blocking.length} open P0/P1 Codex findings` : '',
    invalid.length > 0 ? `${invalid.length} invalid deferrals` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    status: 'completed',
    conclusion: 'failure',
    title: capped ? `${counts}; round ${round}, reconsider the approach` : counts,
    summary: `${
      narrowed
        ? `${roundNote(round)}\n\n`
        : capped
          ? `Review block round ${round} (cap ${BLOCK_ROUND_CAP}): stop fixing findings one line at a time. Name the bug class behind them, fix every instance, or change the approach; the PR is labelled \`${HUMAN_LABEL}\` for a human. The check stays red until the threads are resolved.\n\n`
          : ''
    }${blockedSummary(blocking, invalid)}${carried}${
      carriedRound.length > 0 ? `\n\n${carriedListing(carriedRound)}` : ''
    }`,
    ...(rounds.marked ? {} : { block: blockMarker(sha) }),
    ...human,
    ...record,
  };
}

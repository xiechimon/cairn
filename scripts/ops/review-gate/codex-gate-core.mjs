export const CODEX_LOGIN = 'chatgpt-codex-connector';
export const ACTIONS_LOGIN = 'github-actions[bot]';
export const GATE_CHECK = 'review-gate';
export const STALL_LABEL = 'review-stalled';
export const HUMAN_LABEL = 'review-gate-human';
export const BLOCK_ROUND_CAP = 3;
export const MAX_RETRIES = 2;
export const REQUEST_AFTER_MS = 10 * 60 * 1000;
export const USAGE_DASHBOARD = 'https://chatgpt.com/codex/cloud/settings/usage';

const STATE_RE = /<!-- codex-review-state:v1 (\{.*?\}) -->/s;
const BADGE_RE = /^\s*\*\*<sub><sub>!\[(P[0-3]) Badge\]/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const BLOCK_MARKER_RE = /^<!-- review-gate-block:([0-9a-f]+) -->/;
const LIMIT_RE = /reached your Codex usage limits/i;
const BLOCKING = new Set(['P0', 'P1']);
const WRITE_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MERGE_QUEUE_PREFIX = 'mergify/merge-queue/';
const short = (sha) => sha.slice(0, 7);
const stripBot = (login) => String(login ?? '').replace(/\[bot\]$/, '');

export function parseState(body) {
  const match = STATE_RE.exec(body ?? '');
  if (!match) return null;
  try {
    const review = JSON.parse(match[1]).code_review;
    if (!review || typeof review !== 'object') return null;
    return { commitSha: review.commit_sha ?? null, status: review.status ?? null };
  } catch {
    return null;
  }
}

export function isCodexAuthor(login, type) {
  return type === 'Bot' && stripBot(login) === CODEX_LOGIN;
}

export function trustedStateComment(comments) {
  const trusted = comments
    .filter((comment) => isCodexAuthor(comment.user?.login, comment.user?.type))
    .flatMap((comment) => {
      const state = parseState(comment.body);
      return state ? [{ comment, state }] : [];
    });
  return trusted.reduce(
    (latest, entry) =>
      !latest || Date.parse(entry.comment.updated_at) >= Date.parse(latest.comment.updated_at)
        ? entry
        : latest,
    null,
  );
}

export function usageLimitHit(comments, stateEntry) {
  const newest = comments
    .filter((comment) => isCodexAuthor(comment.user?.login, comment.user?.type))
    .reduce(
      (latest, comment) =>
        !latest || Date.parse(comment.created_at) >= Date.parse(latest.created_at)
          ? comment
          : latest,
      null,
    );
  if (!newest || !LIMIT_RE.test(newest.body ?? '')) return false;
  return !stateEntry || Date.parse(newest.created_at) > Date.parse(stateEntry.comment.updated_at);
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

export function retryMarker(sha, k) {
  return `<!-- review-gate-retry:${sha}:${k} -->`;
}

export function retryStatus(comments, sha, stateUpdatedAt) {
  const prefix = `<!-- review-gate-retry:${sha}:`;
  const mine = comments.filter(
    (comment) => comment.user?.login === ACTIONS_LOGIN && comment.body?.startsWith(prefix),
  );
  const last = mine.reduce(
    (latest, comment) => Math.max(latest, Date.parse(comment.created_at)),
    Number.NEGATIVE_INFINITY,
  );
  return {
    count: mine.length,
    pending: mine.length > 0 && stateUpdatedAt !== null && last > Date.parse(stateUpdatedAt),
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

function blockedSummary(blocking) {
  const lines = blocking.map(
    (thread) =>
      `- ${badgeOf(thread.body)} ${threadTitle(thread.body).replace(/^P[0-3]\s+/, '')}: ${thread.url}`,
  );
  return `Resolve each thread (or fix and comment \`@codex review\`):\n\n${lines.join('\n')}`;
}

function carriedNote(carried) {
  if (carried.length === 0) return '';
  const lines = carried.map(
    (thread) =>
      `- ${badgeOf(thread.body)} ${threadTitle(thread.body).replace(/^P[0-3]\s+/, '')}: ${thread.url}`,
  );
  return `\n\nNot blocking, because the flagged lines predate this PR; file a follow-up issue instead:\n\n${lines.join('\n')}`;
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
  if (limitHit && !reviewedHead)
    return {
      status: 'completed',
      conclusion: 'failure',
      title: 'Codex allowance exhausted',
      summary: `Codex reached its usage limit and did not review ${short(sha)}. See the [Codex usage dashboard](${USAGE_DASHBOARD}) and comment \`@codex review\` once the window resets.`,
      addStall: true,
    };
  if (!state || state.commitSha !== sha || !state.status || state.status === 'running') {
    const unseen = !state || state.commitSha !== sha;
    if (unseen && wait && !wait.requested && wait.waitedMs >= REQUEST_AFTER_MS)
      return {
        status: 'in_progress',
        title: `Asked Codex to review ${short(sha)}`,
        summary: `Codex had not started a review of ${short(sha)} after ${REQUEST_AFTER_MS / 60000} minutes, so the gate commented \`@codex review\`.`,
        request: requestMarker(sha),
      };
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
    const k = retries.pending ? retries.count : retries.count + 1;
    return {
      status: 'in_progress',
      title: `Codex review failed; retry ${k} of ${MAX_RETRIES}`,
      summary: `Asked Codex to review ${short(sha)} again.`,
      ...(retries.pending ? {} : { retry: retryMarker(sha, k) }),
    };
  }
  const blocking = blockingThreads(threads);
  const carried = carriedNote(preExistingThreads(threads));
  const blockedHeads = rounds.others + (rounds.marked ? 1 : 0);
  if (blocking.length === 0)
    return {
      status: 'completed',
      conclusion: 'success',
      title: `No open P0/P1 Codex findings for ${short(sha)}`,
      summary: `Codex reviewed this head and no unresolved P0 or P1 thread remains.${
        blockedHeads > 0 ? ` Cycles to pass: ${blockedHeads} blocked head(s) before this one.` : ''
      }${carried}`,
      removeStall: true,
    };
  const round = rounds.others + 1;
  const capped = round >= BLOCK_ROUND_CAP;
  return {
    status: 'completed',
    conclusion: 'failure',
    title: capped
      ? `${blocking.length} open P0/P1 Codex findings; round ${round}, reconsider the approach`
      : `${blocking.length} open P0/P1 Codex findings`,
    summary: `${
      capped
        ? `Review block round ${round} (cap ${BLOCK_ROUND_CAP}): stop fixing findings one line at a time. Name the bug class behind them, fix every instance, or change the approach; the PR is labelled \`${HUMAN_LABEL}\` for a human. The check stays red until the threads are resolved.\n\n`
        : ''
    }${blockedSummary(blocking)}${carried}`,
    ...(rounds.marked ? {} : { block: blockMarker(sha) }),
    ...(capped && !rounds.marked ? { addHuman: true } : {}),
  };
}

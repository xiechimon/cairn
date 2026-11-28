import { execFileSync } from 'node:child_process';

export const REQUIRED_CHECKS = ['check', 'pack-smoke', 'e2e-gate'];
export const RELEASE_MARKER = 'queue/main release:';
const OWNER_TRAILER = /^(Amp-Thread-ID|Lane):[ \t]*(.+?)[ \t]*$/gim;

export function ownerOf(message) {
  const last = [...message.matchAll(OWNER_TRAILER)].at(-1);
  if (!last) return null;
  if (last[1].toLowerCase() === 'amp-thread-id') {
    const id = /T-[0-9a-f-]+/.exec(last[2])?.[0];
    return id ? { key: `amp:${id}`, label: `https://ampcode.com/threads/${id}` } : null;
  }
  return { key: `lane:${last[2]}`, label: `lane ${last[2]}` };
}

const gh = (args, options = {}) =>
  JSON.parse(
    execFileSync('gh', ['api', ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    }),
  );

const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

export function closingTargets(commits) {
  const targets = new Map();
  for (const commit of commits) {
    for (const match of (commit.body ?? '').matchAll(CLOSING_KEYWORD)) {
      const issue = Number(match[1]);
      targets.set(issue, [...(targets.get(issue) ?? []), commit]);
    }
  }
  return targets;
}

export function landedCommits(before, after) {
  return git(['log', '--reverse', '--format=%H%x1f%s%x1f%B%x1e', `${before}..${after}`])
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split('\x1f');
      return { sha, subject, body };
    });
}

export function closingComment(commits) {
  const lines = commits.map((c) => `- ${c.sha.slice(0, 9)} ${c.subject}`);
  return [`Closed by ${commits.length === 1 ? 'commit' : 'commits'}:`, ...lines].join('\n');
}

export function closeLandedIssues({ commits, getIssue, postComment, closeIssue, warn }) {
  const closed = [];
  for (const [issue, naming] of closingTargets(commits)) {
    try {
      const info = getIssue(issue);
      if (info?.state !== 'open') continue;
    } catch (error) {
      warn(`issue #${issue}: ${String(error.message ?? error).split('\n')[0]}`);
      continue;
    }
    try {
      postComment(issue, closingComment(naming));
    } catch (error) {
      warn(`issue #${issue} comment: ${String(error.message ?? error).split('\n')[0]}`);
    }
    try {
      closeIssue(issue);
      closed.push(issue);
    } catch (error) {
      warn(`issue #${issue} close: ${String(error.message ?? error).split('\n')[0]}`);
    }
  }
  return closed;
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const CHECK_LAG_REFUSAL = /GH013: Repository rule violations[\s\S]*required status check/i;
const LAND_PUSH_ATTEMPTS = 8;
const LAND_BACKOFF_BASE_SECONDS = 10;
const LAND_BACKOFF_CAP_SECONDS = 120;

export function isCheckLagRefusal(output) {
  return CHECK_LAG_REFUSAL.test(output);
}

export function pushToMain({
  sha,
  mainTip,
  push,
  recheck,
  sleep,
  log = console.log,
  attempts = LAND_PUSH_ATTEMPTS,
  baseSeconds = LAND_BACKOFF_BASE_SECONDS,
  capSeconds = LAND_BACKOFF_CAP_SECONDS,
}) {
  for (let attempt = 1; ; attempt += 1) {
    const result = push();
    if (result.status === 0) return;
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const lag = isCheckLagRefusal(output);
    if (!lag || attempt >= attempts) {
      const error = new Error(
        lag
          ? `git push ${sha}:refs/heads/main still refused with GH013 after ${attempt} attempts`
          : `git push ${sha}:refs/heads/main failed`,
      );
      error.status = result.status ?? 1;
      throw error;
    }
    const wait = Math.min(baseSeconds * 2 ** (attempt - 1), capSeconds);
    log(
      `[promote-queue] ruleset refused a green candidate (GH013); attempt ${attempt + 1}/${attempts} in ${wait}s`,
    );
    sleep(wait);
    const state = recheck();
    if (state.landed) {
      log('[promote-queue] main already contains the candidate; landed while backing off');
      return;
    }
    if (state.mainTip !== mainTip) {
      const error = new Error('main moved during the GH013 backoff; not retrying');
      error.status = 1;
      throw error;
    }
  }
}

export function closeIssuesAfterLanding({ repo, before, after, logPrefix = '[promote-queue]' }) {
  try {
    const ghWrite = (args) => {
      const tokens = new Set([process.env.QUEUE_WRITE_TOKEN, process.env.GH_TOKEN, undefined]);
      let last;
      for (const token of tokens) {
        try {
          return gh(args, token ? { env: { ...process.env, GH_TOKEN: token } } : undefined);
        } catch (error) {
          last = error;
        }
      }
      throw last;
    };
    const closed = closeLandedIssues({
      commits: landedCommits(before, after),
      getIssue: (n) => ghWrite([`repos/${repo}/issues/${n}`]),
      postComment: (n, body) =>
        ghWrite(['--method', 'POST', `repos/${repo}/issues/${n}/comments`, '-f', `body=${body}`]),
      closeIssue: (n) =>
        ghWrite(['--method', 'PATCH', `repos/${repo}/issues/${n}`, '-f', 'state=closed']),
      warn: (message) => console.log(`::warning::${message}`),
    });
    if (closed.length > 0)
      console.log(`${logPrefix} closed ${closed.map((n) => `#${n}`).join(', ')}`);
  } catch (error) {
    console.log(
      `::warning::issue closing after landing failed: ${String(error.message ?? error).split('\n')[0]}`,
    );
  }
}

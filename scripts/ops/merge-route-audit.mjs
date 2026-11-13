import { execFileSync } from 'node:child_process';

const shaPattern = /^[a-f0-9]{40}$/;

const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

function eventTime(event) {
  return typeof event.created_at === 'string' ? Date.parse(event.created_at) : Number.NaN;
}

export function queuedBeforeMerge(mergedAt, timeline) {
  if (typeof mergedAt !== 'string') return false;
  const mergeTime = Date.parse(mergedAt);
  if (Number.isNaN(mergeTime)) return false;
  const labelAtMerge = (name) => {
    const changes = timeline
      .filter((event) => {
        const at = eventTime(event);
        return (
          (event.event === 'labeled' || event.event === 'unlabeled') &&
          event.label?.name === name &&
          !Number.isNaN(at) &&
          at < mergeTime
        );
      })
      .sort((a, b) => eventTime(a) - eventTime(b));
    return changes.at(-1)?.event === 'labeled';
  };
  return labelAtMerge('queued') && !labelAtMerge('dequeued');
}

export function auditPull(repo, number) {
  const pull = JSON.parse(gh('api', `repos/${repo}/pulls/${number}`));
  const timeline = JSON.parse(
    gh('api', `repos/${repo}/issues/${number}/timeline`, '--paginate', '--slurp'),
  ).flat();
  const queued = queuedBeforeMerge(pull.merged_at, timeline);
  const line = queued
    ? `queue-audit: #${number} merged through the queue`
    : `queue-audit: #${number} merged without a queued label before ${pull.merged_at ?? 'an unknown head'}`;
  return { number, queued, line };
}

const requiredDraftChecks = [
  'check',
  'pack-smoke',
  'e2e-gate',
  'gates',
  'dead-class-gate',
  'ops-backup-test',
];

const queueDraftHead = 'mergify/merge-queue/';

function isQueueDraft(pull) {
  const ref = pull.head?.ref;
  return (
    pull.user?.login === 'mergify[bot]' && typeof ref === 'string' && ref.startsWith(queueDraftHead)
  );
}

function listedNumbers(list) {
  return [...list.matchAll(/\d+/g)].map((match) => Number(match[0]));
}

function originalNumbers(pull) {
  const title = pull.title ?? '';
  const body = pull.body ?? '';
  const found = [];
  const titled = title.match(/^(?:Merge of #|merge queue:\s+merged\s+#)(\d+(?:\s*,\s*#\d+)*)/i);
  if (titled) found.push(...listedNumbers(titled[1]));
  for (const match of body.matchAll(/Merge of #(\d+(?:\s*,\s*#\d+)*)/gi)) {
    found.push(...listedNumbers(match[1]));
  }
  const lines = body.split(/\r?\n/);
  const header = lines.findIndex((line) => line.trim() === 'pull_requests:');
  if (header >= 0) {
    for (const line of lines.slice(header + 1)) {
      if (line.trim() === '') continue;
      const item = /^\s*-\s+number:\s*(\d+)\s*$/.exec(line);
      if (!item) break;
      found.push(Number(item[1]));
    }
  }
  return [...new Set(found)];
}

export function pullNumbersForCommit(repo, sha) {
  if (!shaPattern.test(sha ?? '')) throw new Error('A full 40-hex commit SHA is required');
  const pulls = JSON.parse(gh('api', `repos/${repo}/commits/${sha}/pulls`));
  const numbers = [];
  for (const pull of pulls) {
    if (pull.state !== 'closed') continue;
    if (!isQueueDraft(pull)) {
      numbers.push(pull.number);
      continue;
    }
    const originals = originalNumbers(pull);
    if (originals.length === 0) {
      throw new Error(`queue draft #${pull.number} does not name its original pull request`);
    }
    numbers.push(...originals);
  }
  return [...new Set(numbers)];
}

function passedDraftNumber(comments) {
  let draft = null;
  for (const comment of comments) {
    if (comment.user?.login !== 'mergify[bot]' || typeof comment.body !== 'string') continue;
    for (const match of comment.body.matchAll(/Passed\*{0,2}\s*·\s*draft #(\d+)/g)) {
      draft = Number(match[1]);
    }
  }
  return draft;
}

function commitTree(repo, sha) {
  const commit = JSON.parse(gh('api', `repos/${repo}/commits/${sha}`));
  const tree = commit.commit?.tree?.sha;
  return shaPattern.test(tree ?? '') ? tree : null;
}

function draftChecksPassedBefore(repo, sha, mergedAt) {
  const mergeTime = Date.parse(mergedAt);
  if (Number.isNaN(mergeTime)) return false;
  const body = JSON.parse(gh('api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`));
  const runs = body.check_runs ?? [];
  return requiredDraftChecks.every((name) => {
    const finished = runs
      .filter((run) => run.name === name && Date.parse(run.completed_at ?? '') < mergeTime)
      .sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at))
      .at(-1);
    return finished?.conclusion === 'success' || finished?.conclusion === 'skipped';
  });
}

export function testedOnLandedTree(repo, number, landedSha) {
  if (!shaPattern.test(landedSha ?? '')) return false;
  const pull = JSON.parse(gh('api', `repos/${repo}/pulls/${number}`));
  if (typeof pull.merged_at !== 'string') return false;
  const comments = JSON.parse(
    gh('api', `repos/${repo}/issues/${number}/comments`, '--paginate', '--slurp'),
  ).flat();
  const draft = passedDraftNumber(comments);
  if (draft === null) return false;
  const draftPull = JSON.parse(gh('api', `repos/${repo}/pulls/${draft}`));
  const draftSha = draftPull.head?.sha;
  if (!shaPattern.test(draftSha ?? '')) return false;
  const landedTree = commitTree(repo, landedSha);
  const draftTree = commitTree(repo, draftSha);
  if (landedTree === null || landedTree !== draftTree) return false;
  return draftChecksPassedBefore(repo, draftSha, pull.merged_at);
}

export function landedThroughQueue(repo, commits) {
  return (
    commits.length > 0 &&
    commits.every((sha) => {
      const numbers = pullNumbersForCommit(repo, sha);
      return numbers.length > 0 && numbers.every((number) => testedOnLandedTree(repo, number, sha));
    })
  );
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  if (command === 'commit') {
    if (args.length !== 1) throw new Error('usage: merge-route-audit commit <sha>');
    const numbers = pullNumbersForCommit(repo, args[0]);
    if (numbers.length === 0) {
      console.log('queue-audit: no merged pull request names this commit');
      return;
    }
    const results = numbers.map((number) => auditPull(repo, number));
    for (const result of results) console.log(result.line);
    process.exitCode = results.every((result) => result.queued) ? 0 : 1;
    return;
  }
  if (command === 'landed') {
    console.log(landedThroughQueue(repo, args));
    return;
  }
  throw new Error('usage: merge-route-audit commit <sha> | landed <sha>...');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

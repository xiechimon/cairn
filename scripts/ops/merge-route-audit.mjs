import { execFileSync } from 'node:child_process';

const shaPattern = /^[a-f0-9]{40}$/;

const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

export function queuedBeforeMerge(mergedAt, timeline) {
  const queued = timeline.filter(
    (event) =>
      event.event === 'labeled' &&
      event.label?.name === 'queued' &&
      typeof event.created_at === 'string',
  );
  if (queued.length === 0) return false;
  if (typeof mergedAt !== 'string') return false;
  const mergeTime = Date.parse(mergedAt);
  return queued.some((event) => Date.parse(event.created_at) < mergeTime);
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

export function pullNumbersForCommit(repo, sha) {
  if (!shaPattern.test(sha ?? '')) throw new Error('A full 40-hex commit SHA is required');
  const pulls = JSON.parse(gh('api', `repos/${repo}/commits/${sha}/pulls`));
  return pulls.filter((pull) => pull.state === 'closed').map((pull) => pull.number);
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
  throw new Error('usage: merge-route-audit commit <sha>');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

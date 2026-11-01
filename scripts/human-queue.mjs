import { execFileSync } from 'node:child_process';
import { humanQueueReasons, mainRoutingPolicy } from './merge-route.mjs';

const ownerRouteLabel = 'owner-route';
const ownerRouteMarker = (sha) => `<!-- batch-merger-owner-route:${sha} -->`;

const printable = (text) =>
  String(text).replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).trim();
const pages = (path) => JSON.parse(gh(['api', path, '--paginate', '--slurp'])).flat();

function resolveRepo() {
  const repo =
    process.env.GITHUB_REPOSITORY ||
    gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Invalid repository: ${repo}`);
  return repo;
}

function age(createdAt, now) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function markedReasons(repo, pr) {
  const marker = ownerRouteMarker(pr.head.sha);
  const comment = pages(`repos/${repo}/issues/${pr.number}/comments?per_page=100`)
    .filter((item) => typeof item.body === 'string' && item.body.startsWith(marker))
    .at(-1);
  const reasons = (comment?.body ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
  return reasons.length > 0 ? reasons : [`${ownerRouteLabel} label`];
}

const repo = resolveRepo();
const policy = mainRoutingPolicy();
const now = Date.now();
const queued = [];
for (const pr of pages(`repos/${repo}/pulls?state=open&per_page=100`)) {
  const files = pages(`repos/${repo}/pulls/${pr.number}/files?per_page=100`).flatMap((file) =>
    [file.filename, file.previous_filename].filter(
      (name) => typeof name === 'string' && name.length > 0,
    ),
  );
  const reasons = humanQueueReasons([...new Set(files)], policy);
  if (pr.labels.some((label) => label.name === ownerRouteLabel))
    reasons.push(...markedReasons(repo, pr));
  if (reasons.length > 0) queued.push({ pr, reasons: [...new Set(reasons)] });
}

if (queued.length === 0) console.log('human queue: empty');
else console.log(`human queue: ${queued.length} open PR(s), oldest first`);
for (const { pr, reasons } of queued.sort(
  (a, b) => Date.parse(a.pr.created_at) - Date.parse(b.pr.created_at),
)) {
  console.log(`\n#${pr.number}  ${age(pr.created_at, now)}  ${printable(pr.title)}`);
  console.log(`  ${printable(pr.html_url)}`);
  for (const reason of reasons) console.log(`  - ${printable(reason)}`);
}

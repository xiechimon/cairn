import { execFileSync } from 'node:child_process';

const REPO = 'xiechimon/cairn';
const n = process.argv[2];
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });
const DEP_LINE = /(依赖|前置|Blocked-By|Depends on|blocked by|等)[^\n]*/gi;
const issue = JSON.parse(gh(['issue', 'view', n, '-R', REPO, '--json', 'body,comments']));
const body = [
  issue.body ?? '',
  ...issue.comments.map((c) => c.body).filter((b) => b.includes('<!-- acceptance-checklist v1')),
].join('\n');
const deps = new Set();
for (const line of body.match(DEP_LINE) ?? []) {
  if (/依赖[：:]\s*无/.test(line)) continue;
  for (const m of line.matchAll(/#(\d{2,5})/g)) if (m[1] !== n) deps.add(m[1]);
}
try {
  for (const d of JSON.parse(gh(['api', `repos/${REPO}/issues/${n}/dependencies/blocked_by`])))
    deps.add(String(d.number));
} catch {}
const open = [...deps].filter((d) => {
  try {
    return JSON.parse(gh(['issue', 'view', d, '-R', REPO, '--json', 'state'])).state === 'OPEN';
  } catch {
    return false;
  }
});
if (open.length) {
  console.log(open.map((d) => `#${d}`).join(' '));
  process.exit(1);
}

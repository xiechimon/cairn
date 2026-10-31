import { execFileSync } from 'node:child_process';

const REPO = 'xiechimon/cairn';
const TRACKER_TITLE = 'Cairn 排期（自动更新）';
const BOT = `${process.env.HOME}/.cairn/tools/app-token/as-bot.sh`;
const apply = process.argv.includes('--apply');
const quiet = process.argv.includes('--quiet');

const gh = (args, input) =>
  execFileSync(apply ? BOT : 'gh', apply ? ['gh', ...args] : args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 << 20,
  });
const ghRead = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 });

const issues = JSON.parse(
  ghRead([
    'issue',
    'list',
    '-R',
    REPO,
    '--state',
    'open',
    '--limit',
    '500',
    '--json',
    'number,title,labels,body,updatedAt',
  ]),
).filter((i) => i.title !== TRACKER_TITLE);
const closed = new Set(
  JSON.parse(
    ghRead([
      'issue',
      'list',
      '-R',
      REPO,
      '--state',
      'closed',
      '--limit',
      '1000',
      '--json',
      'number',
    ]),
  ).map((i) => i.number),
);
const openPrs = JSON.parse(
  ghRead([
    'pr',
    'list',
    '-R',
    REPO,
    '--state',
    'open',
    '--limit',
    '200',
    '--json',
    'number,title,body,isDraft',
  ]),
);

const DEP_LINE = /(依赖|前置|Blocked-By|Depends on|blocked by|等)[^\n]*/gi;
const depsOf = (body) => {
  const deps = new Set();
  for (const line of (body ?? '').match(DEP_LINE) ?? []) {
    if (/依赖[：:]\s*无/.test(line)) continue;
    for (const m of line.matchAll(/#(\d{2,5})/g)) deps.add(Number(m[1]));
  }
  return [...deps];
};
const labelsOf = (i) => i.labels.map((l) => l.name);
const batchOf = (i) =>
  labelsOf(i)
    .find((l) => l.startsWith('batch:'))
    ?.slice(6);
const byOf = (i) =>
  labelsOf(i)
    .find((l) => l.startsWith('by:'))
    ?.slice(3);
const prFor = (n) =>
  openPrs
    .filter((p) => new RegExp(`#${n}\\b|\\(${n}\\)`).test(`${p.title}\n${p.body}`))
    .map((p) => p.number);

const changes = [];
const relabel = (i, add, remove = []) => {
  changes.push({ n: i.number, add, remove });
  if (apply) {
    const args = ['issue', 'edit', String(i.number), '-R', REPO, '--add-label', add];
    if (remove.length) args.push('--remove-label', remove.join(','));
    gh(args);
  }
  i.labels = i.labels.filter((l) => !remove.includes(l.name)).concat({ name: add });
};

const unscheduled = [];
const unblocked = [];
for (const i of issues) {
  i.deps = depsOf(i.body).filter((d) => d !== i.number);
  i.openDeps = i.deps.filter((d) => !closed.has(d));
  const batches = labelsOf(i).filter((l) => l.startsWith('batch:'));
  if (batches.length > 1) {
    const keep = ['batch:now', 'batch:next', 'batch:later'].find((b) => batches.includes(b));
    relabel(
      i,
      keep,
      batches.filter((b) => b !== keep),
    );
  }
  if (!batchOf(i)) {
    unscheduled.push(i.number);
    relabel(i, i.openDeps.length ? 'batch:later' : 'batch:next');
  } else if (
    batchOf(i) === 'later' &&
    i.deps.length &&
    i.openDeps.length === 0 &&
    !labelsOf(i).includes('waits-ian')
  ) {
    unblocked.push(i.number);
    relabel(i, 'batch:next', ['batch:later']);
  }
}

const EXEC = { cairn: 'Cairn 自跑', codex: 'codex', pi: 'pi', grok: 'grok' };
const line = (i) => {
  const parts = [`#${i.number} ${i.title}`];
  if (byOf(i)) parts.push(EXEC[byOf(i)] ?? byOf(i));
  const prs = prFor(i.number);
  if (prs.length) parts.push(`PR ${prs.map((p) => `#${p}`).join(' ')}`);
  if (i.openDeps.length) parts.push(`等 ${i.openDeps.map((d) => `#${d}`).join(' ')}`);
  return `- ${parts.join(' · ')}`;
};
const section = (title, list) =>
  `## ${title}（${list.length}）\n\n${list.length ? list.map(line).join('\n') : '- 无'}\n`;
const sorted = (f) => issues.filter(f).sort((a, b) => a.number - b.number);

const waitsIan = sorted((i) => labelsOf(i).includes('waits-ian'));
const body = [
  '> 这张票由 omarchy 上的定时任务每天更新（`cairn-issue-schedule.timer`），别手改，改票上的标签就行：`batch:now` / `batch:next` / `batch:later`、`by:cairn|codex|pi|grok`、`waits-ian`。',
  `> 更新于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC，开放 ${issues.length} 张。`,
  '',
  section('等 ian', waitsIan),
  section(
    '现在',
    sorted((i) => batchOf(i) === 'now' && !labelsOf(i).includes('waits-ian')),
  ),
  section(
    '下一批',
    sorted((i) => batchOf(i) === 'next' && !labelsOf(i).includes('waits-ian')),
  ),
  section(
    '以后',
    sorted((i) => batchOf(i) === 'later' && !labelsOf(i).includes('waits-ian')),
  ),
].join('\n');

const summary = [
  unscheduled.length && `新票没排期，已自动放进批次：${unscheduled.map((n) => `#${n}`).join(' ')}`,
  unblocked.length &&
    `依赖已解开，从「以后」挪到「下一批」：${unblocked.map((n) => `#${n}`).join(' ')}`,
  `等你的票 ${waitsIan.length} 张：${waitsIan.map((i) => `#${i.number}`).join(' ') || '无'}`,
].filter(Boolean);

if (!apply) {
  console.log(body);
  console.log('\n--- summary ---\n' + summary.join('\n'));
  process.exit(0);
}

let tracker = JSON.parse(
  ghRead([
    'issue',
    'list',
    '-R',
    REPO,
    '--state',
    'open',
    '--search',
    `"${TRACKER_TITLE}" in:title`,
    '--json',
    'number,title',
  ]),
).find((i) => i.title === TRACKER_TITLE);
if (!tracker) {
  const url = gh(
    ['issue', 'create', '-R', REPO, '--title', TRACKER_TITLE, '--body-file', '-'],
    body,
  ).trim();
  tracker = { number: Number(url.split('/').pop()) };
  gh(['issue', 'pin', String(tracker.number), '-R', REPO]);
} else {
  const current = JSON.parse(
    ghRead(['issue', 'view', String(tracker.number), '-R', REPO, '--json', 'body']),
  ).body;
  const strip = (t) => t.replace(/^> 更新于.*$/m, '');
  if (strip(current).trim() !== strip(body).trim())
    gh(['issue', 'edit', String(tracker.number), '-R', REPO, '--body-file', '-'], body);
  else if (quiet) process.exit(0);
}
if (quiet && !unscheduled.length && !unblocked.length) process.exit(0);
const mention = !quiet && (unscheduled.length || unblocked.length) ? '@xiechimon ' : '';
gh(
  ['issue', 'comment', String(tracker.number), '-R', REPO, '--body-file', '-'],
  `${mention}今日排期：\n\n${summary.map((s) => `- ${s}`).join('\n')}`,
);
console.log(`https://github.com/${REPO}/issues/${tracker.number}`);

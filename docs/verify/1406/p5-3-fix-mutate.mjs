// #1406 P5-3 follow-up mutation runner (same shape as p5-3-mutate.mjs): for
// each rule this fix adds, copy the source file into a scratch directory,
// apply one mutation, run the named test files, record the summary, then copy
// the saved file back and check its sha256. An edit is an anchored
// replacement ({from, to}); the anchor must occur exactly once.
// Run from the repo root:
//   node docs/verify/1406/p5-3-fix-mutate.mjs "$PWD" <scratch-dir> > docs/verify/1406/p5-3-fix-mutations.txt
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = process.argv[2];
const scratch = process.argv[3];
if (!root || !scratch) throw new Error('usage: p5-3-fix-mutate.mjs <repo-root> <scratch-dir>');
mkdirSync(scratch, { recursive: true });
const sha = (s) => createHash('sha256').update(s).digest('hex');

const PROMPTS = 'packages/shared/src/records/prompts.ts';
const ATTACH = 'apps/daemon/src/step-attachments.ts';
const CHIEF = 'apps/server/src/services/chief.ts';
const CHIEF_TOOLS = 'apps/server/src/services/chief-tools.ts';
const SHARED_T = 'packages/shared/test/issue-fence.test.ts';
const ATTACH_T = 'apps/daemon/test/step-attachments.test.ts';
const DAEMON_T = 'apps/daemon/test/runner-issue-fence.test.ts';
const SERVER_T = 'apps/server/test/issue-fence.test.ts';

const mutations = [
  {
    id: 'M1',
    rule: 'prefix acceptance: a fenced line whose unquoted text is a whole-line token is a token line',
    note: 'tokenLinesOf ignores the unquoted text of fenced lines (only bare token lines count)',
    file: ATTACH,
    edits: [
      {
        from: '    const body = quoted[i] ?? null;\n',
        to: '    const body: string | null = null;\n',
      },
    ],
    tests: [ATTACH_T, DAEMON_T],
  },
  {
    id: 'M2',
    rule: 'prefix kept: rewritten and added lines of a fenced token stay quoted inside the fence',
    note: 'emit pushes rewritten lines as they are, without quoting',
    file: ATTACH,
    edits: [
      {
        from: '      outLines.push(token.quoted ? quoteIssueLines(text) : text);\n',
        to: '      outLines.push(text);\n',
      },
    ],
    tests: [ATTACH_T, DAEMON_T],
  },
  {
    id: 'M10',
    rule: 'one quoting path: rewritten lines use quoteIssueLines (line-break fold), not a split on \\n',
    note: 'emit prefixes each \\n-separated line itself, so U+2028 / \\x85 / \\r in a file name or error survive',
    file: ATTACH,
    edits: [
      {
        from: '      outLines.push(token.quoted ? quoteIssueLines(text) : text);\n',
        to: "      outLines.push(token.quoted ? text.split('\\n').map((l) => `> ${l}`).join('\\n') : text);\n",
      },
    ],
    tests: [ATTACH_T],
  },
  {
    id: 'M11',
    rule: 'one file name: safeFileName drops line-break variants and Cf, so the note path matches the disk',
    note: 'safeFileName drops code points below 0x20 only (the #730 rule)',
    file: ATTACH,
    edits: [
      {
        from: '    if (cp < 0x20 || cp === 0x85 || cp === 0x2028 || cp === 0x2029) continue;\n    if (FORMAT_CHAR.test(ch)) continue;\n',
        to: '    if (cp < 0x20) continue;\n',
      },
    ],
    tests: [ATTACH_T],
  },
  {
    id: 'M3',
    rule: 'region: only lines inside a fence are unquoted (quoted tokens elsewhere stay untouched)',
    note: 'issueFenceQuotedLines unquotes every line that starts with "> "',
    file: PROMPTS,
    edits: [
      {
        from: '    return inFence && line.startsWith(ISSUE_FENCE_QUOTE)\n',
        to: '    return line.startsWith(ISSUE_FENCE_QUOTE)\n',
      },
    ],
    tests: [ATTACH_T],
  },
  {
    id: 'M4',
    rule: 'region: the bare closing line ends the fence',
    note: 'every line that starts with the fence marker opens a region, the closing line too',
    file: PROMPTS,
    edits: [
      {
        from: '      inFence = !line.startsWith(ISSUE_FENCE_CLOSE);\n',
        to: '      inFence = true;\n',
      },
    ],
    tests: [ATTACH_T],
  },
  {
    id: 'M5',
    rule: 'wake title fencing: an issue-sourced todo is rendered through the fence',
    note: 'wakeFacts renders every todo as #n「<title>」 (the #1475 behavior)',
    file: CHIEF,
    edits: [{ from: '  if (!isIssueSourcedTask(todo)) {\n', to: '  if (true) {\n' }],
    tests: [SERVER_T],
  },
  {
    id: 'M6',
    rule: 'wake title fencing: the instruction sentence names the task by #seqNum only',
    note: 'the fence is appended, but the sentence still quotes the title in 「」',
    file: CHIEF,
    edits: [
      {
        from: '  const ref = `#${todo.seqNum}（标题出自 GitHub issue，原文在下方围栏里）`;\n',
        to: '  const ref = `#${todo.seqNum}「${todo.title}」`;\n',
      },
    ],
    tests: [SERVER_T],
  },
  {
    id: 'M7',
    rule: 'rule text: the chief third-party data rule names wake prompts',
    note: 'the parenthesis naming orchestrate requests and wake prompts is dropped',
    file: CHIEF,
    edits: [
      {
        from: '（编排请求与 wake 轮提示都会带这种围栏：从 GitHub issue 导入的任务，wake 轮提示的指令句只写 #序号，标题只在围栏里）',
        to: '',
      },
    ],
    tests: [SERVER_T],
  },
  {
    id: 'M8',
    rule: 'Cf stripping: format characters are removed from fenced issue text',
    note: 'the FORMAT_CHARS replace is dropped from fenceIssueText',
    file: PROMPTS,
    edits: [{ from: "    .replace(FORMAT_CHARS, '')\n", to: '' }],
    tests: [SHARED_T],
  },
  {
    id: 'M9',
    rule: 'memory gate after inlining quotesIssueFence: the title is checked as well as the content',
    note: 'saveMemoryEntry checks the content only',
    file: CHIEF_TOOLS,
    edits: [
      {
        from: '  if (input.title.includes(ISSUE_FENCE_OPEN) || input.content.includes(ISSUE_FENCE_OPEN)) {\n',
        to: '  if (input.content.includes(ISSUE_FENCE_OPEN)) {\n',
      },
    ],
    tests: [SERVER_T],
  },
];

function apply(text, edit, id) {
  const hits = text.split(edit.from).length - 1;
  if (hits !== 1) throw new Error(`${id}: anchor occurs ${hits} times`);
  return text.replace(edit.from, () => edit.to);
}

const out = [];
for (const m of mutations) {
  const path = join(root, m.file);
  const saved = join(scratch, `${m.id}-${basename(m.file)}`);
  copyFileSync(path, saved);
  const original = readFileSync(saved, 'utf8');
  let mutated = original;
  for (const e of m.edits) mutated = apply(mutated, e, m.id);
  writeFileSync(path, mutated);
  let log = '';
  let status = 0;
  try {
    log = execFileSync('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', ...m.tests], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
  } catch (err) {
    status = err.status ?? 1;
    log = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    copyFileSync(saved, path);
  }
  if (sha(readFileSync(path, 'utf8')) !== sha(original)) throw new Error(`${m.id}: restore failed`);
  const lines = log.split('\n');
  const failed = lines.filter((l) => /^\s+×/.test(l)).map((l) => l.replace(/\s+\d+ms$/, '').trim());
  const reasons = lines
    .filter((l) => /^AssertionError|^HttpError|^Error:|^TypeError/.test(l))
    .map((l) => l.trim().slice(0, 240));
  const summary = lines.filter((l) => /^\s+(Test Files|Tests)\s/.test(l));
  out.push(
    `## ${m.id}: ${m.rule}`,
    `file: ${m.file}`,
    `mutation: ${m.note}`,
    ...m.edits.map((e) => `  edit: ${JSON.stringify(e.from.trim())} -> ${JSON.stringify(e.to.trim())}`),
    `tests: ${m.tests.join(' ')}`,
    `vitest exit: ${status} (${status === 0 ? 'SURVIVED' : 'KILLED'})`,
    ...summary.map((l) => l.trim()),
    'failing cases:',
    ...failed.map((l) => `  ${l}`),
    'first assertion messages:',
    ...reasons.slice(0, 4).map((l) => `  ${l}`),
    `restored by copying back the scratch copy ${basename(saved)} (sha256 ${sha(original)})`,
    '',
  );
}
process.stdout.write(`${out.join('\n')}\n`);

// #1406 P5-3 mutation runner (same shape as docs/verify/1466/r2-mutate.mjs):
// apply one mutation to the sources, run the named test files, record the
// summary, restore the original bytes (sha256-checked). An edit is either an
// anchored replacement ({from, to}; the anchor must occur exactly once) or
// {dropLine}: remove the one line that contains the substring.
// Run from the repo root: node docs/verify/1406/p5-3-mutate.mjs "$PWD" > docs/verify/1406/p5-3-mutations.txt
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = process.argv[2];
const sha = (s) => createHash('sha256').update(s).digest('hex');

const PROMPTS = 'packages/shared/src/records/prompts.ts';
const SHARED_T = 'packages/shared/test/issue-fence.test.ts';
const PERSONA_T = 'packages/shared/test/persona.test.ts';
const DAEMON_T = 'apps/daemon/test/runner-issue-fence.test.ts';
const SERVER_T = 'apps/server/test/issue-fence.test.ts';
const SKILLS_T = 'apps/server/test/persona-repo-rules.test.ts';
const WEB_T = 'apps/web/test/transcript-issue-fence.test.ts';

const mutations = [
  {
    id: 'M1',
    rule: 'fence removed: the task text of a github-issue task is fenced',
    note: 'buildTaskPromptText returns title + spec for every source',
    file: PROMPTS,
    edits: [
      {
        from: '  return isIssueSourcedTask(source) ? fenceIssueText(source?.sourceRef, text) : text;\n',
        to: '  return text;\n',
      },
    ],
    tests: [SHARED_T, DAEMON_T, SERVER_T, WEB_T],
  },
  {
    id: 'M2',
    rule: 'fence removed: the orchestrate message of a github-issue task is fenced',
    note: 'buildOrchestratePrompt always quotes the spec as 任务原文',
    file: PROMPTS,
    edits: [{ from: '  const source = isIssueSourcedTask(todo)\n', to: '  const source = false\n' }],
    tests: [SHARED_T, SERVER_T],
  },
  {
    id: 'M3',
    rule: 'escape not handled: line terminators other than \\n are folded before quoting',
    note: 'the LINE_BREAKS normalization is dropped, so \\r or U+2028 starts an unprefixed line',
    file: PROMPTS,
    edits: [{ from: "    .replace(LINE_BREAKS, '\\n')\n", to: '' }],
    tests: [SHARED_T],
  },
  {
    id: 'M4',
    rule: 'escape not handled: every body line is prefixed, so a fake footer stays inside',
    note: 'fenceIssueText stops prefixing body lines with "> "',
    file: PROMPTS,
    edits: [
      {
        from: "    .map((line) => `> ${line}`.trimEnd())\n    .join('\\n');\n  return `${ISSUE_FENCE_OPEN}",
        to: "    .join('\\n');\n  return `${ISSUE_FENCE_OPEN}",
      },
    ],
    tests: [SHARED_T, DAEMON_T, SERVER_T],
  },
  {
    id: 'M5',
    rule: 'escape not handled: owner/repo segments of the ref are checked before they go into the header',
    note: 'issueFenceLabel trusts any parsed ref, so a newline or 】 in the ref splits or closes the header',
    file: PROMPTS,
    edits: [
      {
        from: "  if (parsed === null || !SAFE_REPO_SEGMENT.test(parsed.owner)) return '出处未知';\n  if (!SAFE_REPO_SEGMENT.test(parsed.repo)) return '出处未知';\n",
        to: "  if (parsed === null) return '出处未知';\n",
      },
    ],
    tests: [SHARED_T],
  },
  {
    id: 'M6',
    rule: 'system-prompt rule removed: composeChiefSystemPrompt names the fence and GitHub text as third-party data',
    note: 'the 第三方数据 line is dropped from 工作约定',
    file: 'apps/server/src/services/chief.ts',
    edits: [{ dropLine: '- 第三方数据：' }],
    tests: [SERVER_T],
  },
  {
    id: 'M7',
    rule: 'plain task fenced: only sourceKind github-issue is third-party text',
    note: "isIssueSourcedTask matches every kind starting with 'github-issue' (so github-issue-self too)",
    file: PROMPTS,
    edits: [
      {
        from: "  return source?.sourceKind === 'github-issue';\n",
        to: "  return source?.sourceKind?.startsWith('github-issue') === true;\n",
      },
    ],
    tests: [SHARED_T, DAEMON_T],
  },
  {
    id: 'M8',
    rule: 'plain task fenced: a task with any source is not fenced',
    note: 'isIssueSourcedTask is true for any non-null sourceKind (orchestration too)',
    file: PROMPTS,
    edits: [
      {
        from: "  return source?.sourceKind === 'github-issue';\n",
        to: '  return source?.sourceKind != null;\n',
      },
    ],
    tests: [SHARED_T, DAEMON_T],
  },
  {
    id: 'M9',
    rule: 'save_memory refuses text that carries the fence marker',
    note: 'the saveMemoryEntry gate is disabled',
    file: 'apps/server/src/services/chief-tools.ts',
    edits: [
      {
        from: '  if (quotesIssueFence(input.title) || quotesIssueFence(input.content)) {\n',
        to: '  if (false) {\n',
      },
    ],
    tests: [SERVER_T],
  },
  {
    id: 'M10',
    rule: 'issue title stays out of the worker systemPrompt without meta.titleFinal',
    note: 'taskMetaOpts short-circuits on meta.titleFinal only, as on main',
    file: 'apps/daemon/src/runner.ts',
    edits: [
      {
        from: '  if (todo.meta?.titleFinal === true || isIssueSourcedTask(todo)) return undefined;\n',
        to: '  if (todo.meta?.titleFinal === true) return undefined;\n',
      },
    ],
    tests: [DAEMON_T],
  },
  {
    id: 'M11',
    rule: 'the build claim carries the source to the daemon',
    note: 'machines.ts claim payload drops sourceKind / sourceRef',
    file: 'apps/server/src/services/machines.ts',
    edits: [
      {
        from: '        sourceKind: cand.todoRow.sourceKind,\n        sourceRef: cand.todoRow.sourceRef,\n',
        to: '',
      },
    ],
    tests: [SERVER_T],
  },
  {
    id: 'M12',
    rule: 'the chief orchestrate path passes the source',
    note: 'orchestrate.ts drops sourceKind / sourceRef',
    file: 'apps/server/src/services/orchestrate.ts',
    edits: [{ from: '    sourceKind: record.sourceKind,\n    sourceRef: record.sourceRef,\n', to: '' }],
    tests: [SERVER_T],
  },
  {
    id: 'M13',
    rule: 'the verify step material is fenced',
    note: 'builds.ts builds the verify task text without the source',
    file: 'apps/server/src/services/builds.ts',
    edits: [
      {
        from: '    taskText: buildTaskPromptText(todoRow.title, todoRow.spec, todoRow),\n',
        to: '    taskText: buildTaskPromptText(todoRow.title, todoRow.spec),\n',
      },
    ],
    tests: [SERVER_T],
  },
  {
    id: 'M14',
    rule: 'web: rows logged before the fence (raw text) still classify as the task text',
    note: 'classifyUserText compares only the fenced form',
    file: PROMPTS,
    edits: [
      {
        from: '  const taskTexts = delivered === raw ? [raw] : [delivered, raw];\n',
        to: '  const taskTexts = [delivered];\n',
      },
    ],
    tests: [SHARED_T, WEB_T],
  },
  {
    id: 'M15',
    rule: 'web: the display todo keeps the source fields',
    note: 'toDisplayTodo drops sourceKind / sourceRef',
    file: 'apps/web/src/api/mappers.ts',
    edits: [{ from: '    sourceKind: w.sourceKind,\n    sourceRef: w.sourceRef,\n', to: '' }],
    tests: [WEB_T],
  },
  {
    id: 'M16',
    rule: 'persona names only skills that exist in .claude/skills',
    note: 'the Implementer text names verify-repo-pacman instead of verify-pacman',
    file: 'packages/shared/src/records/persona.ts',
    edits: [
      {
        from: '（xiechimon/pacman 为 verify-pacman）',
        to: '（xiechimon/pacman 为 verify-repo-pacman）',
      },
    ],
    tests: [SKILLS_T, PERSONA_T],
  },
];

function apply(text, edit, id) {
  if (edit.dropLine !== undefined) {
    const lines = text.split('\n');
    const hits = lines.filter((l) => l.includes(edit.dropLine)).length;
    if (hits !== 1) throw new Error(`${id}: dropLine matches ${hits} lines`);
    return lines.filter((l) => !l.includes(edit.dropLine)).join('\n');
  }
  const hits = text.split(edit.from).length - 1;
  if (hits !== 1) throw new Error(`${id}: anchor occurs ${hits} times`);
  return text.replace(edit.from, () => edit.to);
}

function describeEdit(e) {
  return e.dropLine !== undefined
    ? `  edit: drop the line containing ${JSON.stringify(e.dropLine)}`
    : `  edit: ${JSON.stringify(e.from.trim())} -> ${JSON.stringify(e.to.trim())}`;
}

const out = [];
for (const m of mutations) {
  const path = `${root}/${m.file}`;
  const original = readFileSync(path, 'utf8');
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
    writeFileSync(path, original);
  }
  if (sha(readFileSync(path, 'utf8')) !== sha(original)) throw new Error(`${m.id}: restore failed`);
  const lines = log.split('\n');
  const failed = lines.filter((l) => /^\s+×/.test(l)).map((l) => l.replace(/\s+\d+ms$/, '').trim());
  const reasons = lines
    .filter((l) => /^AssertionError|^HttpError|^Error:|^TypeError/.test(l))
    .map((l) => l.trim());
  const summary = lines.filter((l) => /^\s+(Test Files|Tests)\s/.test(l));
  out.push(
    `## ${m.id}: ${m.rule}`,
    `file: ${m.file}`,
    `mutation: ${m.note}`,
    ...m.edits.map(describeEdit),
    `tests: ${m.tests.join(' ')}`,
    `vitest exit: ${status} (${status === 0 ? 'SURVIVED' : 'KILLED'})`,
    ...summary.map((l) => l.trim()),
    'failing cases:',
    ...failed.map((l) => `  ${l}`),
    'first assertion messages:',
    ...reasons.slice(0, 6).map((l) => `  ${l}`),
    '',
  );
}
process.stdout.write(`${out.join('\n')}\n`);

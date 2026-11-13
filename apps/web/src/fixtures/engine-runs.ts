import type { EngineAnswer, EngineEvent, EngineRun, EngineRunState } from '../board/engine-run.js';
import type { DiffFile, TodoRecord } from './records.js';

export interface EngineScriptStep {
  event: EngineEvent;
  raw: string;
  planDone: number;
}

export interface EngineScript {
  engine: string;
  plan: string[];
  steps: EngineScriptStep[];
  refused?: EngineScriptStep[];
  outcome: 'finished' | 'failed';
  elapsedSeconds: number;
  costUsd: number;
  start: number;
}

export type EngineAnswers = Record<string, EngineAnswer>;

export function engineScriptSteps(
  script: EngineScript,
  answers: EngineAnswers,
): EngineScriptStep[] {
  const refusedAt = script.steps.findIndex(
    ({ event }) => event.kind === 'question' && answers[event.id] === 'refused',
  );
  if (refusedAt < 0 || script.refused === undefined) return script.steps;
  return [...script.steps.slice(0, refusedAt + 1), ...script.refused];
}

export function engineRunAt(
  script: EngineScript,
  shown: number,
  answers: EngineAnswers = {},
  takenOver = false,
): EngineRun {
  const steps = engineScriptSteps(script, answers);
  const visible = steps.slice(0, Math.max(1, shown));
  const ended = visible.length === steps.length;
  const events = visible.map(({ event }, index): EngineEvent => {
    if (event.kind !== 'question') return event;
    const passed = index < visible.length - 1 ? 'allowed' : null;
    return { ...event, answer: answers[event.id] ?? passed };
  });
  const last = events.at(-1);
  const asked = last?.kind === 'question' && last.answer === null;
  const state: EngineRunState = takenOver
    ? 'taken_over'
    : ended
      ? steps === script.steps
        ? script.outcome
        : 'finished'
      : asked
        ? 'waiting'
        : 'running';
  if (state === 'running' && last?.kind === 'run')
    events[events.length - 1] = { ...last, exit: null, output: [], seconds: 0 };
  const planDone = visible.at(-1)?.planDone ?? 0;
  const active = state === 'running' || state === 'waiting' || state === 'taken_over';
  return {
    engine: script.engine,
    state,
    elapsedSeconds: ended ? script.elapsedSeconds : null,
    costUsd: ended ? script.costUsd : null,
    plan: script.plan.map((text, index) => ({
      text,
      state: index < planDone ? 'done' : index === planDone && active ? 'doing' : 'todo',
    })),
    events,
    rawOutput: visible.map((step) => step.raw).join('\n'),
  };
}

export function enginePhase(state: EngineRunState): TodoRecord['phase'] {
  if (state === 'running') return 'building';
  if (state === 'finished') return 'done';
  return state === 'failed' ? 'failed' : 'needs_input';
}

const say = (id: string, text: string, planDone: number): EngineScriptStep => ({
  event: { kind: 'text', id, text },
  raw: `● ${text}`,
  planDone,
});

const read = (id: string, path: string, lines: number, planDone: number): EngineScriptStep => ({
  event: { kind: 'read', id, path, lines, seconds: 0.4 },
  raw: `● Read(${path})\n  ⎿ Read ${lines} lines`,
  planDone,
});

const edit = (id: string, file: DiffFile, planDone: number): EngineScriptStep => ({
  event: { kind: 'edit', id, file },
  raw: `● Update(${file.path})\n  ⎿ +${file.added} −${file.removed ?? 0}`,
  planDone,
});

const run = (
  id: string,
  command: string,
  exit: number,
  seconds: number,
  output: string[],
  planDone: number,
): EngineScriptStep => ({
  event: { kind: 'run', id, command, exit, output, seconds },
  raw: `● Bash(${command})\n  ⎿ ${output.at(-1) ?? ''}`,
  planDone,
});

const DISPOSITION_DIFF: DiffFile = {
  path: 'server/lib/disposition.ts',
  added: 3,
  removed: 1,
  hunks: [
    {
      header: '@@ -4,3 +4,5 @@',
      lines: [
        {
          kind: 'context',
          text: 'export function contentDisposition(name: string) {',
          oldNo: 4,
          newNo: 4,
        },
        { kind: 'del', text: `  return 'attachment; filename="' + name + '"';`, oldNo: 5 },
        { kind: 'add', text: "  const ascii = name.replace(/[^\\x20-\\x7e]/g, '_');", newNo: 5 },
        { kind: 'add', text: '  const utf8 = encodeURIComponent(name);', newNo: 6 },
        {
          kind: 'add',
          text: `  return 'attachment; filename="' + ascii + '"; filename*=' + utf8;`,
          newNo: 7,
        },
        { kind: 'context', text: '}', oldNo: 6, newNo: 8 },
      ],
    },
  ],
};

const OPENING: EngineScriptStep[] = [
  say('say-start', '先看下载接口怎么设置文件名。', 0),
  read('read-route', 'server/routes/attachments.ts', 142, 1),
  edit('edit-disposition', DISPOSITION_DIFF, 2),
  run(
    'run-unit',
    'pnpm vitest run disposition',
    0,
    0.4,
    ['✓ server/lib/disposition.test.ts (7)', 'Tests  7 passed (7)'],
    2,
  ),
];

const FILENAME_FIX: EngineScript = {
  engine: 'Claude Code',
  plan: [
    '找到设置文件名的地方',
    '改成同时带 ASCII 和 UTF-8 两种文件名',
    '跑完整上传测试',
    '汇报结果',
  ],
  steps: [
    ...OPENING,
    {
      event: {
        kind: 'unknown',
        id: 'compaction',
        type: 'context_compaction',
        payload: JSON.stringify(
          { type: 'context_compaction', before_tokens: 148200, after_tokens: 41800 },
          null,
          2,
        ),
      },
      raw: '✻ Compacting conversation…',
      planDone: 2,
    },
    {
      event: {
        kind: 'question',
        id: 'ask-upload',
        text: '完整上传测试会真的往存储里写文件，要继续吗？',
        answer: null,
      },
      raw: '? Bash(pnpm test:upload) 会写入存储。继续吗？ (y/n)',
      planDone: 2,
    },
    run(
      'run-upload',
      'pnpm test:upload',
      0,
      38,
      ['✓ upload/roundtrip.test.ts (31)', 'Tests  31 passed (31)'],
      3,
    ),
    say(
      'say-done',
      '改好了：文件名现在同时带 ASCII 回退和 UTF-8 编码，中文名下载不再乱码。测试全部通过。',
      4,
    ),
  ],
  refused: [
    say(
      'say-refused',
      '好，不跑完整上传测试。单元测试 7 项已通过，改动留在工作区，等你决定下一步。',
      2,
    ),
  ],
  outcome: 'finished',
  elapsedSeconds: 252,
  costUsd: 0.21,
  start: 4,
};

const UPLOAD_FAILED: EngineScript = {
  ...FILENAME_FIX,
  steps: [
    ...OPENING,
    run(
      'run-upload',
      'pnpm test:upload',
      1,
      41,
      [
        'FAIL upload/roundtrip.test.ts > keeps the UTF-8 name through the CDN',
        "Expected: filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf",
        'Received: filename="__.pdf"',
        'Tests  1 failed | 30 passed (31)',
      ],
      2,
    ),
    say(
      'say-failed',
      '完整上传测试有 1 项没过：CDN 回源时丢了 UTF-8 文件名。这不在下载接口里，我先停下。',
      2,
    ),
  ],
  refused: undefined,
  outcome: 'failed',
  elapsedSeconds: 407,
  costUsd: 0.58,
  start: 6,
};

const SWEEP_FILES = [
  'server/routes/attachments.ts',
  'server/routes/exports.ts',
  'server/routes/avatars.ts',
  'server/routes/backups.ts',
  'server/lib/disposition.ts',
  'server/lib/mime.ts',
  'server/lib/storage.ts',
  'server/lib/signed-url.ts',
  'web/src/download-link.tsx',
  'web/src/export-menu.tsx',
  'worker/src/archive.ts',
  'worker/src/report.ts',
];

function sweepFile(path: string, index: number): EngineScriptStep[] {
  const seen = read(`sweep-read-${index}`, path, 64 + index * 23, index < 4 ? 0 : 1);
  if (index < 4) return [seen];
  const line = 12 + index;
  const changed = edit(
    `sweep-edit-${index}`,
    {
      path,
      added: 1,
      removed: 1,
      hunks: [
        {
          header: `@@ -${line},1 +${line},1 @@`,
          lines: [
            {
              kind: 'del',
              text: `  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');`,
              oldNo: line,
            },
            {
              kind: 'add',
              text: "  res.setHeader('Content-Disposition', contentDisposition(name));",
              newNo: line,
            },
          ],
        },
      ],
    },
    1,
  );
  if (index % 4 !== 3) return [seen, changed];
  const tests = `Tests  ${4 + index} passed (${4 + index})`;
  return [
    seen,
    changed,
    run(`sweep-run-${index}`, `pnpm vitest run ${path}`, 0, 2 + index, [tests], 2),
  ];
}

const FILENAME_SWEEP: EngineScript = {
  engine: 'Codex',
  plan: ['找出所有设置文件名的地方', '逐个改用同一个函数', '跑全部测试', '汇报结果'],
  steps: [
    say('sweep-start', '设置文件名的地方不止下载接口一处，我先把它们都找出来。', 0),
    ...SWEEP_FILES.flatMap(sweepFile),
    run('sweep-run-all', 'pnpm test', 0, 96, ['Tests  1843 passed (1843)'], 3),
    say(
      'sweep-done',
      '8 个文件都改用 `contentDisposition`，导出、头像和备份的下载文件名不再乱码。全部测试通过。',
      4,
    ),
  ],
  outcome: 'finished',
  elapsedSeconds: 1126,
  costUsd: 1.84,
  start: Number.MAX_SAFE_INTEGER,
};

export const ENGINE_SCRIPTS = {
  running: FILENAME_FIX,
  waiting: { ...FILENAME_FIX, start: 6 },
  finished: { ...FILENAME_FIX, start: 8 },
  failed: UPLOAD_FAILED,
  unknown: { ...FILENAME_FIX, start: 5 },
  long: FILENAME_SWEEP,
} satisfies Record<string, EngineScript>;

// Detail-route surfaces: probe #9 plan/transcript/changeset canon, the
// per-phase detail sets, r3 legacy details, and the build-scoped overlay
// payload lookup (issue #68).

import { BRAND, conversationBranch } from '@cairn/shared';
import {
  at,
  legacyDone,
  legacyReview,
  MACHINE_NAME,
  PROBE_BRANCH_INFO,
  PROBE_ID,
  PROBE_RUN_HISTORY,
  PROBE_TOKEN_USAGE,
  probeTodo,
  R3_DAY,
  r7,
} from './core.js';
import type {
  BranchInfoContent,
  BuildOverlayContent,
  ChangesContent,
  DocBlock,
  FixtureSet,
  RunHistoryRow,
  TodoRecord,
  TokenUsageContent,
  TranscriptItem,
} from './records.js';

/** r7 probe #10 — the dark fresh capture (23d) is a separate throwaway
 *  todo: title/seq/creation time all read off that bitmap. */
const probe10: TodoRecord = {
  ...probeTodo('todo', r7(13, 40)),
  id: 'r7-probe-10',
  title: 'r7-dark-fresh 探针（拍完即删）',
  spec: 'r7-dark-fresh 探针（拍完即删）',
  seqNum: 10,
};

/** Plan document of probe #9, verbatim from the r7 17 doc pane except for the
 *  section labels: XMON-55 P2 promotes the four canon sections (PLAN_SECTIONS)
 *  from body-weight lines to `.doc-block--head`, so the four `label:` paras the
 *  r7 capture froze as plain text are now head blocks with their remainder
 *  trailing — what mapPlanDoc's planSectionHead does to the live wire text. */
const PROBE_PLAN_DOC: DocBlock[] = [
  { kind: 'head', segments: [{ text: 'Context' }] },
  {
    kind: 'para',
    segments: [
      {
        text: '仓库根目录的 README.md 当前末尾一行为 "r6 rebaseline probe"(文件以换行符结尾)。需求是在文件末尾追加新的一行 "r7 rebaseline probe"。',
      },
    ],
  },
  { kind: 'head', segments: [{ text: 'Changes' }] },
  {
    kind: 'bullet',
    segments: [
      {
        text: 'README.md:在文件末尾追加一行新内容 "r7 rebaseline probe",保持与现有行一致的格式(纯文本行,行尾换行符),不改动文件中已有的其他内容。',
      },
    ],
  },
  { kind: 'head', segments: [{ text: 'Edge cases' }] },
  { kind: 'para', segments: [{ text: '无。' }] },
  { kind: 'head', segments: [{ text: 'Verification' }] },
  {
    kind: 'bullet',
    segments: [
      { text: '执行 ' },
      { text: 'tail -n 3 README.md', style: 'code' },
      {
        text: ' 确认最后一行为 "r7 rebaseline probe",且原有的 "r6 rebaseline probe" 一行保留在其上一行。',
      },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      { text: '执行 ' },
      { text: 'git diff README.md', style: 'code' },
      { text: ' 确认改动仅为新增一行,未影响其他行。' },
    ],
  },
];

/** Probe #9 transcript while planning (r7 16): stamp, start bubble, live
 *  step row. */
const PROBE_RUN_OPEN: TranscriptItem[] = [
  { kind: 'run', at: '13:26', machine: MACHINE_NAME },
  {
    kind: 'user',
    text: '开始执行任务',
    seq: 9,
    title: '在 README.md 末尾追加一行「r7 rebaseline probe」',
  },
];

/** Probe #9 transcript while planning (r7 16): run open + live step row. */
const PROBE_PLANNING_TRANSCRIPT: TranscriptItem[] = [
  ...PROBE_RUN_OPEN,
  { kind: 'streaming', seconds: 3, label: '准备工作区...' },
];

/** Probe #9 transcript once the plan landed (r7 17/17b/17d, and 16d which
 *  the r7 manifest filed under the streaming name). */
const PROBE_CONFIRM_TRANSCRIPT: TranscriptItem[] = [
  ...PROBE_RUN_OPEN,
  {
    kind: 'robot',
    paragraphs: [
      [{ text: '任务简单明确:在 README.md 末尾追加一行新文本,文件已有末尾换行行,直接追加即可。' }],
    ],
  },
  {
    kind: 'plan',
    title: '方案 · v1',
    preview:
      'Context: 仓库根目录的 README.md 当前末尾一行为 "r6 rebaseline probe"(文件以换行符结尾)。需求是在文件末尾追加新的一行 "r7 rebaseline probe"。  Changes: README.md:在文件末尾追加一行新内容 "r7 rebaseline probe",保持与现有行一致的格式(纯文本行,行尾换行符),不改动文件中已有的其他内容。',
    seconds: 21,
  },
];

/** Execution round open, shared by the 26/26d/27/27b/28/36 surfaces: plan
 *  round + 13:35 stamp + the user's 确认 bubble (r7 §5 时序). */
export const PROBE_BUILD_OPEN: TranscriptItem[] = [
  ...PROBE_CONFIRM_TRANSCRIPT,
  { kind: 'note', text: '13:35' },
  { kind: 'user', text: '确认' },
];

/** Agent result message closing the execution round (r7 26d/27/36;
 *  straight quotes + fullwidth commas per the captures). */
export const PROBE_BUILD_RESULT: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    [
      {
        text: '已在 README.md 末尾追加一行"r7 rebaseline probe"，验证通过，未影响其他内容。',
      },
    ],
  ],
  footer: {},
};

/** The two tool calls of the execution round (r7 28 expanded form:
 *  `edit README.md` + the verification `bash …` pill). The bash label is
 *  also the 26d streaming row's 调用工具 text — the capture runs it to
 *  the chat edge with an ellipsis. */
export const PROBE_TOOL_PILLS = [
  'edit README.md',
  'bash cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && tail -n 3 README.md && echo …',
];

/** Streaming-row tool label of the 26d capture — chrome carried inside the
 *  fixture (frozen capture text); the en dict keys on this exact value. */
export const PROBE_TOOL_CALL_LABEL = `调用工具：${PROBE_TOOL_PILLS[1]}`;

/** Tool-call group row of the execution round (r7 27 collapsed `完成
 *  19s ▸`; r7 28 expanded with pills + 收起). */
function probeTools(expanded: boolean): TranscriptItem {
  return { kind: 'tools', seconds: 19, expanded, pills: PROBE_TOOL_PILLS };
}

/** Merge round appended on completion (r7 36/36d): announcement stamp,
 *  merge-result message with the mono command chip, elapsed row, 🎉
 *  banner. */
const PROBE_MERGE_ROUND: TranscriptItem[] = [
  { kind: 'note', text: 'Xmon Dai 发起了合并' },
  {
    kind: 'robot',
    paragraphs: [
      [
        { text: 'git merge origin/main', style: 'code' },
        { text: ' 结果为 "Already up to date"，无需处理冲突。' },
      ],
    ],
    footer: { seconds: 17 },
  },
  { kind: 'note', text: '🎉 任务已完成' },
];

/** r3 legacy #1 transcript (r7 38): schedule-triggered run waiting on the
 *  user's reply — stamp + 由定时发起 + start bubble + the agent's
 *  no-op analysis (code chips around the probe line and the commit
 *  subject) + 完成 32s. */
const LEGACY_REVIEW_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '星期六 14:30', machine: 'r3-mbp' },
  { kind: 'scheduled' },
  {
    kind: 'user',
    text: '开始执行任务',
    seq: 1,
    title: '在 README.md 末尾追加一行「r3 lifecycle probe」',
  },
  {
    kind: 'robot',
    paragraphs: [
      [
        { text: 'README.md 中已存在这行内容（' },
        { text: 'r3 lifecycle probe', style: 'code' },
        { text: '），且历史提交记录显示已有一次' },
      ],
      [
        { text: 'docs（readme）：append lifecycle probe line', style: 'code' },
        { text: ' 的提交完成了这项任务。当前工作区无待提交更改，' },
      ],
      [{ text: '任务已满足，无需重复修改。' }],
    ],
    footer: { seconds: 32 },
  },
];

/** The probe's one-file changeset (r7 27/27b/36): README.md +1 line.
 *  `expanded` is the pane's initial state — review surfaces pass true
 *  (XMON-55 P2), the captured-collapsed form is opt-in. */
export function probeChanges(expanded: boolean): ChangesContent {
  return {
    expanded,
    files: [
      {
        path: 'README.md',
        added: 1,
        hunks: [
          {
            header: '@@ -3,3 +3,4 @@ r3 lifecycle probe',
            lines: [
              { kind: 'context', text: 'r3 lifecycle probe2', oldNo: 3, newNo: 3 },
              { kind: 'context', text: 'r5b lifecycle probe', oldNo: 4, newNo: 4 },
              { kind: 'context', text: 'r6 rebaseline probe', oldNo: 5, newNo: 5 },
              { kind: 'add', text: 'r7 rebaseline probe', newNo: 6 },
            ],
          },
        ],
        // #225 全文槽:与 hunk 窗(@@ -3,3 +3,4 @@)自洽的六行——3–5 行 =
        // 窗内 context 原文,第 6 行 = +行;初渲不展示,视觉零影响。
        fullContent:
          '# r3 probe\nprobe readme\nr3 lifecycle probe2\nr5b lifecycle probe\nr6 rebaseline probe\nr7 rebaseline probe\n',
      },
    ],
  };
}

/** Detail fresh state (r7 23): no transcript, no doc pane. */
export const detailFresh: FixtureSet = {
  todos: [probeTodo('todo', r7(13, 21))],
  now: r7(13, 22),
};

/** Detail fresh state, dark capture (r7 23d = probe #10). */
export const detailFreshDark: FixtureSet = { todos: [probe10], now: r7(13, 41) };

/** Detail planning state (r7 16): live transcript, empty doc pane. */
export const detailPlanning: FixtureSet = {
  todos: [probeTodo('planning', r7(13, 26))],
  now: r7(13, 26),
  detail: { transcript: PROBE_PLANNING_TRANSCRIPT },
};

/** Detail confirm state (r7 17/17b/17d, plus 16d = same surface dark with
 *  the popover). `userMenuOpen` reproduces the popover the 17 and 16d
 *  captures include. */
export function detailConfirm(userMenuOpen: boolean): FixtureSet {
  return {
    todos: [probeTodo('confirm', r7(13, 26))],
    now: r7(13, 28),
    detail: { transcript: PROBE_CONFIRM_TRANSCRIPT, doc: PROBE_PLAN_DOC, userMenuOpen },
  };
}

/** Detail building state (r7 26/26d): execution streaming. The light
 *  capture froze at `3s › 处理中...`; the dark one (with the user menu
 *  open) caught the later `19s › 调用工具：bash …` after the result
 *  message landed. `lateCapture` selects the dark capture's later
 *  moment — the theme itself comes from the matrix row. */
export function detailBuilding(lateCapture: boolean): FixtureSet {
  const tail: TranscriptItem[] = lateCapture
    ? [
        PROBE_BUILD_RESULT,
        {
          kind: 'streaming',
          seconds: 19,
          // full command rides the label; CSS ellipsis cuts it at the
          // chat edge exactly like the capture
          label: PROBE_TOOL_CALL_LABEL,
        },
      ]
    : [{ kind: 'streaming', seconds: 3, label: '处理中...' }];
  return {
    todos: [probeTodo('building', r7(13, 35))],
    now: r7(13, 36),
    detail: {
      transcript: [...PROBE_BUILD_OPEN, ...tail],
      doc: PROBE_PLAN_DOC,
      userMenuOpen: lateCapture,
    },
  };
}

/** #471 quiescent building gap (named scenario, no capture — the
 *  detail-unread precedent): the task is executing but the agent is not
 *  streaming (no active step) — the transcript keeps one live row through
 *  the same streaming component: loading indicator (#672: loading-dev
 *  Atom) + the static 执行中... label, no seconds counter. [设计] */
export function detailSpinnerQuiescent(): FixtureSet {
  return {
    todos: [probeTodo('building', r7(13, 35))],
    now: r7(13, 36),
    detail: {
      transcript: [...PROBE_BUILD_OPEN, { kind: 'streaming', label: '执行中...' }],
      doc: PROBE_PLAN_DOC,
    },
  };
}

/** Detail review state (r7 27/27b/28). XMON-55 P2 flipped the changes-pane
 *  default to expanded: the r7 27/27d captures froze it collapsed, which
 *  left the 488px pane holding one file row over blank space. The dark
 *  capture carries the user-menu popover. */
export function detailReview(opts: {
  userMenuOpen: boolean;
  changesExpanded?: boolean;
  toolsExpanded?: boolean;
}): FixtureSet {
  return {
    todos: [probeTodo('review', r7(13, 37))],
    now: r7(13, 40),
    detail: {
      transcript: [
        ...PROBE_BUILD_OPEN,
        PROBE_BUILD_RESULT,
        probeTools(opts.toolsExpanded ?? false),
      ],
      changes: probeChanges(opts.changesExpanded ?? true),
      userMenuOpen: opts.userMenuOpen,
    },
  };
}

/** #1250（ADR 0018 层 1）verify verdict 行三态（named scenario，无 capture —
 *  skills-routing 先例）：review 面之上叠一条 passed、一条 failed（带两条
 *  证据）与一条判定提取失败行——pass 徽标（绿）与 fail 徽标（红）都是有效
 *  结论，extractionError 在位才走「判定提取失败」档。证据条目 = path 等宽
 *  块 + 可选注记，是验证面「读 verdict 即知证据落哪」的核心交付。 */
export function detailVerifyVerdict(): FixtureSet {
  const base = detailReview({ userMenuOpen: false });
  const verifyRows: TranscriptItem[] = [
    {
      kind: 'verify',
      passed: true,
      conclusion: 'e2e 与单测全绿，证据已入仓。',
      evidence: [{ path: 'docs/verify/1250/e2e.json', note: '923 条全过' }],
    },
    {
      kind: 'verify',
      passed: false,
      conclusion: '两条失败用例需修复后复验。',
      evidence: [
        { path: 'docs/verify/1250/fulltest.log' },
        { path: 'docs/verify/1250/failures.txt', note: '第 3/41 条' },
      ],
    },
    {
      kind: 'verify',
      passed: false,
      conclusion: '判定提取失败',
      evidence: [],
      extractionError: '终轮输出不含合法 JSON',
    },
  ];
  return {
    ...base,
    detail: {
      ...base.detail,
      transcript: [...(base.detail?.transcript ?? []), ...verifyRows],
    },
  };
}

/** #1101 diff-pane stress changeset (named scenario, no capture —
 *  chief-threads-long precedent). One file, three hunks, pinning the five
 *  shapes the word-level highlight + horizontal-scroll fixes must handle:
 *  a one-word del/add pair (word highlight), an uneven del run against a
 *  shorter add run (minimum pairing, the surplus del stays whole-line),
 *  a marker row separating a del/add pair (r8 72 adjacency shape — pairing
 *  must see through markers), long rows (the horizontal-scroll bg face) and
 *  an oversized pair beyond the word-diff cap (the loud fallback face). */
const STRESS_MEGA_ARGS = Array.from({ length: 120 }, (_, i) => `field${i}: "value${i}"`).join(', ');

function stressChanges(): ChangesContent {
  const longDel =
    'renderDashboard({ title: "Quarterly Revenue Overview", region: "apac", quarter: "Q3", limit: 100, offset: 0, sort: "createdAt", filter: { active: true } });';
  const longAdd = longDel.replace('limit: 100', 'limit: 200');
  const cappedDel = `const mega = { ${STRESS_MEGA_ARGS} };`;
  const cappedAdd = cappedDel.replace('field7: "value7"', 'field7: "VALUE7"');
  const lines = [
    { kind: 'context' as const, text: 'import { retry } from "./retry.js";', oldNo: 1, newNo: 1 },
    { kind: 'del' as const, text: 'const timeoutMs = 3000; // retry window', oldNo: 2 },
    { kind: 'add' as const, text: 'const timeoutMs = 5000; // retry window', newNo: 2 },
    { kind: 'context' as const, text: 'const attempts = 3;', oldNo: 3, newNo: 3 },
    { kind: 'context' as const, text: 'const jitter = 0.2;', oldNo: 4, newNo: 4 },
    {
      kind: 'context' as const,
      text: 'export { timeoutMs, attempts, jitter };',
      oldNo: 5,
      newNo: 5,
    },
  ];
  return {
    expanded: true,
    files: [
      {
        path: 'src/pipeline/config.ts',
        added: 4,
        removed: 5,
        hunks: [
          { header: '@@ -1,5 +1,5 @@', lines },
          {
            header: '@@ -20,4 +20,3 @@',
            lines: [
              { kind: 'del', text: 'keepAlpha = true;', oldNo: 20 },
              { kind: 'del', text: 'keepBeta = true;', oldNo: 21 },
              { kind: 'add', text: 'keepAlpha = false;', newNo: 20 },
              { kind: 'context', text: 'keepGamma = true;', oldNo: 22, newNo: 21 },
              { kind: 'context', text: 'keepDelta = true;', oldNo: 23, newNo: 22 },
            ],
          },
          {
            header: '@@ -40,3 +40,3 @@',
            lines: [
              { kind: 'del', text: longDel, oldNo: 40 },
              { kind: 'marker', text: 'No newline at end of file' },
              { kind: 'add', text: longAdd, newNo: 40 },
              { kind: 'del', text: cappedDel, oldNo: 41 },
              { kind: 'add', text: cappedAdd, newNo: 41 },
              { kind: 'context', text: 'export default pipeline;', oldNo: 42, newNo: 42 },
            ],
          },
        ],
        // #225 full-file slot: the long rows ride here too so the 显示完整文件
        // face exercises the same horizontal-scroll width contract.
        fullContent: [
          '// src/pipeline/config.ts',
          longAdd,
          cappedAdd,
          'export default pipeline',
          '',
        ].join('\n'),
      },
    ],
  };
}

/** #1101 review surface carrying the stress changeset above. */
export function detailDiffWordStress(): FixtureSet {
  return {
    todos: [probeTodo('review', r7(13, 37))],
    now: r7(13, 40),
    detail: {
      transcript: [...PROBE_BUILD_OPEN, PROBE_BUILD_RESULT],
      changes: stressChanges(),
    },
  };
}

/** Detail done state (r7 36/36d): review surface + merge round. */
export function detailDone(): FixtureSet {
  return {
    todos: [probeTodo('done', r7(13, 52))],
    now: r7(13, 55),
    detail: {
      transcript: [
        ...PROBE_BUILD_OPEN,
        PROBE_BUILD_RESULT,
        probeTools(false),
        ...PROBE_MERGE_ROUND,
      ],
      changes: probeChanges(true),
    },
  };
}

/** r3 legacy #1 detail (r7 38): read-only review surface, schedule
 *  marker, no changes to show (`暂无可显示的变更`). */
export const detailLegacy: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 58),
  detail: { transcript: LEGACY_REVIEW_TRANSCRIPT },
};

/** Overlay payloads of the r3 legacy #1 build as the r8 78–80 dark captures
 *  froze them (issue #68): probe #9 no longer exists on the live account, so
 *  the dark overlay pairs bind to this todo's own build data. #1 re-ran on
 *  2026-09-22 18:30 (schedule trigger), which replaced the r7 38 surface:
 *  new run stamp, four-run history, a real changeset, no awaiting-reply. */
const LEGACY_TOKEN_USAGE: TokenUsageContent = {
  total: '66.1k',
  model: 'r3-gw/claude-sonnet-5',
  modelTotal: '66.1k',
  input: '10',
  output: '424',
  cacheRead: '52.3k',
  cacheWrite: '13.4k',
  cacheHitRate: '100%',
};

const LEGACY_BRANCH_INFO: BranchInfoContent = {
  // capture 79 truncates the branch after `2488`; the tail is unobservable
  // and only needs to keep the mono row overflowing at the same glyph
  branch: conversationBranch('01a0c8aa-9e64-742b-acbd-2488a1b2c3d4'),
  commit: 'f3ce121ba492',
  machine: MACHINE_NAME,
  directory: '~/preview/project',
};

/** r8 57 surface: #12's failed build whose single history row IS the
 *  failed current run — 当前 chip + footer 重跑 (r8 57); title/seq verbatim
 *  from the r8 54/57 captures. The failed-detail background behind the
 *  dialog is a later ticket, so the fixture pair rides smoke for now. */
const FAILED_CURRENT_ID = 'r8-failed-12';
const failedCurrentTodo: TodoRecord = {
  ...probeTodo('failed', at('2026-09-22', 12, 30)),
  id: FAILED_CURRENT_ID,
  seqNum: 12,
  title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  spec: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
};

const FAILED_CURRENT_RUNS: RunHistoryRow[] = [
  {
    label: '第 1 次运行',
    meta: '6 小时前 · 72.1k tokens · Machine offline',
    status: 'failed-current',
  },
];

export function detailFailedCurrent(): FixtureSet {
  return {
    todos: [failedCurrentTodo],
    now: at('2026-09-22', 18, 30),
    // the failed-state transcript surface is a later ticket; the smoke
    // pair only gates the dialog over whatever the detail route renders
    detail: { transcript: [] },
  };
}

const LEGACY_RUN_HISTORY: RunHistoryRow[] = [
  { label: '第 4 次运行', meta: '6 小时前 · 66.1k tokens', status: 'current' },
  { label: '第 3 次运行', meta: '3 天前 · Cancelled', status: 'failed' },
  { label: '第 2 次运行', meta: '3 天前', status: 'done' },
  { label: '第 1 次运行', meta: '4 天前 · Machine offline', status: 'failed' },
];

/** r3 legacy #2 overlay payload — [推断]: no capture ever opened an overlay
 *  on this build; the values exist so the done card's branch icon opens a
 *  dialog instead of dead-clicking. No e2e row rides them. */
const LEGACY2_OVERLAY: BuildOverlayContent = {
  token: {
    total: '41.7k',
    model: 'r3-gw/claude-sonnet-5',
    modelTotal: '41.7k',
    input: '9',
    output: '388',
    cacheRead: '31.6k',
    cacheWrite: '9.4k',
    cacheHitRate: '100%',
  },
  branch: {
    branch: conversationBranch('r3-legacy-2'),
    commit: 'b7e1f0a9c4d2',
    machine: MACHINE_NAME,
    directory: '~/preview/project',
  },
  runs: [{ label: '第 1 次运行', meta: '2 天前 · 41.7k tokens', status: 'done' }],
};

/** r3 legacy #1 as of the r8 dark captures (2026-09-23): review phase,
 *  schedule-triggered run of 2026-09-22 18:30, single-paragraph result. */
const legacyNow: TodoRecord = {
  ...legacyReview,
  phaseAt: at('2026-09-22', 18, 30),
  lastRunAt: at('2026-09-22', 18, 30),
  hasChanges: true,
  hasPlan: true,
  awaitingReply: false,
  buildHistory: [
    { buildId: 'r3-conv-legacy-1', createdAt: at(R3_DAY, 13, 5) },
    { buildId: 'r3-conv-legacy-1b', createdAt: at('2026-09-22', 18, 30) },
  ],
};

/** Two synthetic confirm-phase todos: the dark captures show the sidebar
 *  看板 badge at 2 (live board had two confirm cards); the detail route
 *  renders nothing of them but the badge. */
const darkBadgeFillers: TodoRecord[] = [1, 2].map((n) => ({
  ...legacyNow,
  id: `dark-badge-filler-${n}`,
  phase: 'confirm',
}));

const LEGACY_NOW_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '昨天 18:30', machine: MACHINE_NAME },
  { kind: 'scheduled' },
  {
    kind: 'user',
    text: '开始执行任务',
    seq: 1,
    title: '在 README.md 末尾追加一行「r3 lifecycle probe」',
  },
  {
    kind: 'robot',
    paragraphs: [[{ text: '已在 README.md 末尾追加了一行「r3 lifecycle probe」。' }]],
  },
  { kind: 'elapsed', seconds: 25 },
];

/** Dark capture set (r8 78–81): legacy #1's current surface with a frozen
 *  open state — `chiefUnread` reproduces the FAB badge the captures carry.
 *  #366: the token/branch/history freezes moved from the (deleted) overlay
 *  dialogs to the right-pane view (ui.paneView); accept stays an overlay. */
export function detailLegacyNow(freeze: Pick<FixtureSet, 'overlay' | 'ui'>): FixtureSet {
  return {
    todos: [legacyNow, ...darkBadgeFillers],
    now: at('2026-09-23', 0, 13),
    chiefUnread: 1,
    detail: { transcript: LEGACY_NOW_TRANSCRIPT, changes: probeChanges(true) },
    ...freeze,
  };
}

/** Build-scoped overlay display data per todo (issue #68): the dialog
 *  payloads are not record fields (02 §6.2), so the fixture layer maps the
 *  captured builds — probe #9 (r7 30/31/32) and r3 legacy #1 (r8 78–80) —
 *  plus one [推断] set for legacy #2 so its card's branch icon is not a
 *  dead control; no e2e row rides the [推断] values. */
export function overlayContent(todoId: string): BuildOverlayContent | null {
  if (todoId === PROBE_ID) {
    return { token: PROBE_TOKEN_USAGE, branch: PROBE_BRANCH_INFO, runs: PROBE_RUN_HISTORY };
  }
  if (todoId === FAILED_CURRENT_ID) {
    return { token: PROBE_TOKEN_USAGE, branch: PROBE_BRANCH_INFO, runs: FAILED_CURRENT_RUNS };
  }
  if (todoId === legacyReview.id) {
    return { token: LEGACY_TOKEN_USAGE, branch: LEGACY_BRANCH_INFO, runs: LEGACY_RUN_HISTORY };
  }
  if (todoId === legacyDone.id) {
    return LEGACY2_OVERLAY;
  }
  return r8OverlayContent(todoId);
}

/** r8 57/77 run-history rows (upstream #68 shape): the failed current row
 *  carries the 当前 chip and the state-gated 重跑 button (r8 §3.3). */
const RUNS_12: RunHistoryRow[] = [
  {
    label: '第 1 次运行',
    meta: '6 小时前 · 72.1k tokens · Machine offline',
    status: 'failed-current',
  },
];

const RUNS_15: RunHistoryRow[] = [
  { label: '第 2 次运行', meta: '刚刚', status: 'current' },
  {
    label: '第 1 次运行',
    meta: '22 分钟前 · 435.5k tokens · Machine offline',
    status: 'failed',
  },
];

/** [推断] token/branch payloads for the r8 todos — the r8 captures only
 *  exercised the history face; no e2e row rides these values. */
const R8_OVERLAY_TOKEN: TokenUsageContent = {
  total: '72.1k',
  model: 'r3-gw/claude-sonnet-5',
  modelTotal: '72.1k',
  input: '12',
  output: '980',
  cacheRead: '49.7k',
  cacheWrite: '25.4k',
  cacheHitRate: '100%',
};
const R8_OVERLAY_BRANCH: BranchInfoContent = {
  branch: conversationBranch('r8-12'),
  commit: '386b8e4af054',
  machine: MACHINE_NAME,
  directory: `~/${BRAND.homeDirName}/workspaces/r8-12`,
};

export function r8OverlayContent(todoId: string): BuildOverlayContent | null {
  if (todoId === 'r8-12')
    return { token: R8_OVERLAY_TOKEN, branch: R8_OVERLAY_BRANCH, runs: RUNS_12 };
  if (todoId === 'r8-15')
    return {
      token: R8_OVERLAY_TOKEN,
      branch: { ...R8_OVERLAY_BRANCH, branch: conversationBranch('r8-15') },
      runs: RUNS_15,
    };
  return null;
}

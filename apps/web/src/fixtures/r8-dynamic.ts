import { diffLines } from 'diff';
import {
  at,
  MACHINE_NAME,
  PROJECT_ID,
  probeTodo,
  projectContent,
  R3_BUILDER,
  r7,
  r8,
  TEAM_ID,
} from './core.js';
import { PROBE_BUILD_OPEN, PROBE_BUILD_RESULT, probeChanges } from './detail.js';
import type {
  ChangesContent,
  DiffHunk,
  DiffLine,
  DocBlock,
  FixtureSet,
  PlanDiffContent,
  TodoRecord,
  TranscriptItem,
} from './records.js';

// ---- issue #75: r8 dynamic-state sets (reject loop / failed / reuse) ----
// Content verbatim from the r8 captures 54–77 (docs/research/r8-dynamic-
// states.md §1–§3) plus the raw geometry dumps. Two session days: the
// evening of 2026-09-22 (23:1x–23:5x) and the minutes past midnight
// (00:0x, 2026-09-23) — the `昨天 17:38` stamp flip in 57 pins the split.

/** r8 past-midnight (2026-09-23). */
const r8n = (h: number, m: number) => at('2026-09-23', h, m);

/** #12: r5-leftover failed todo, chief-launched, no plan document
 *  (r8 §3.4: hence no 复用方案 button on its rerun dialog). */
const failed12: TodoRecord = {
  id: 'r8-12',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  spec: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  phase: 'failed',
  phaseAt: r8(17, 38),
  seqNum: 12,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r8-conv-12',
  lastRunAt: r8(17, 38),
  hasChanges: true,
  hasPlan: false,
  buildHistory: [{ buildId: 'r8-conv-12', createdAt: r8(17, 38) }],
  sourceTodo: null,
  v: 3,
};

/** #13: review todo of the r8 session — only ever off-screen (board
 *  column 5 sliver) but counted by the 看板 badge (r8 55/57). */
const review13: TodoRecord = {
  id: 'r8-13',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'r8 session review probe',
  spec: 'r8 session review probe',
  phase: 'review',
  phaseAt: r8(22, 50),
  seqNum: 13,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r8-conv-13',
  lastRunAt: r8(22, 40),
  hasChanges: true,
  hasPlan: true,
  buildHistory: [{ buildId: 'r8-conv-13', createdAt: r8(22, 40) }],
  sourceTodo: null,
  v: 2,
};

const R8_TITLE = '在 README.md 末尾追加一行「r8 dynamic probe」';

/** #15 in the given phase (probe of the r8 session). */
function probe15(phase: TodoRecord['phase'], phaseAt: number): TodoRecord {
  return {
    id: 'r8-15',
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: R8_TITLE,
    spec: R8_TITLE,
    phase,
    phaseAt,
    seqNum: 15,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: 'r8-conv-15',
    lastRunAt: r8(23, 40),
    hasChanges: phase === 'failed' || phase === 'review' || phase === 'done',
    hasPlan: phase !== 'todo',
    buildHistory: [
      { buildId: 'r8-conv-15', createdAt: r8(23, 40) },
      ...(phase === 'review' || phase === 'building'
        ? [{ buildId: 'r8-conv-15b', createdAt: r8n(0, 2) }]
        : []),
    ],
    sourceTodo: null,
    v: 4,
  };
}

/** #12 changeset (r8 54): three files, +15. */
const CHANGES_12: ChangesContent = {
  expanded: false,
  files: [
    { path: 'CHANGELOG.md', added: 9, hunks: [] },
    { path: 'README.md', added: 4, hunks: [] },
    { path: 'scripts/hello.js', added: 2, hunks: [] },
  ],
};

/** #15 changeset (r8 73/77): README.md +1. */
const CHANGES_15: ChangesContent = {
  expanded: false,
  files: [{ path: 'README.md', added: 1, hunks: [] }],
};

/** #12 transcript (r8 54): chief-launched run, result message, failed
 *  merge round. `stamp` flips to `昨天 17:38` past midnight (57). */
function transcript12(stamp: string): TranscriptItem[] {
  return [
    { kind: 'run', at: stamp, machine: MACHINE_NAME },
    { kind: 'chief' },
    { kind: 'user', text: '开始执行任务', seq: 12, title: failed12.title },
    {
      kind: 'robot',
      paragraphs: [
        {
          segments: [
            { text: '验证通过，输出为 ' },
            { text: 'hello', style: 'code' },
            { text: '。' },
          ],
        },
        { segments: [{ text: '三项改动均已完成：' }] },
        {
          bullet: true,
          segments: [
            { text: 'README.md', style: 'code' },
            { text: ': 新增「文档目录」章节，列出 ' },
            { text: 'CONTRIBUTING.md', style: 'code' },
            { text: ' 链接（该文件由 ' },
            { text: '#11', style: 'code' },
            { text: ' 负责，尚未合并，链接暂时指向不存在的文件属预期）。' },
          ],
        },
        {
          bullet: true,
          segments: [
            { text: 'CHANGELOG.md', style: 'code' },
            { text: ': 新建文件，写入初始条目。' },
          ],
        },
        {
          bullet: true,
          segments: [
            { text: 'scripts/hello.js', style: 'code' },
            { text: ': 新增脚本，' },
            { text: 'node scripts/hello.js', style: 'code' },
            { text: ' 运行打印 ' },
            { text: 'hello', style: 'code' },
            { text: '（已本地验证）。' },
          ],
        },
      ],
      footer: { seconds: 28 },
    },
    { kind: 'note', text: '18:18' },
    { kind: 'note', text: 'Xmon Dai 发起了合并' },
    {
      kind: 'fail',
      title: '运行该任务的机器已离线',
      body: '请将其重新上线，或重新运行任务以改派其他机器。',
      links: ['查看原始错误', '排查指南'],
    },
  ];
}

/** plan.md section paragraph per version wording (`w` = the appended
 *  line; r8 63/76 doc panes). The first README.md chip is link-styled. */
function planDoc(w: string, withCommit: boolean, msg: string): DocBlock[] {
  const blocks: DocBlock[] = [
    { kind: 'head', segments: [{ text: 'Context' }] },
    {
      kind: 'para',
      segments: [
        { text: '仓库根目录的 ' },
        { text: 'README.md', style: 'link' },
        { text: ' 目前内容为逐行累积的"探针记录"（' },
        { text: 'r3 lifecycle probe', style: 'code' },
        { text: '、' },
        { text: 'r6 rebaseline probe', style: 'code' },
        { text: '、' },
        { text: 'r7 rebaseline probe', style: 'code' },
        {
          text: ' 等），每次任务在文件末尾新增一行文字，文件以换行符结尾。本次任务按同样的惯例，在文件末尾追加一行 ',
        },
        { text: w, style: 'code' },
        { text: '。' },
      ],
    },
    { kind: 'head', segments: [{ text: '改动' }] },
    {
      kind: 'bullet',
      segments: [
        { text: 'README.md', style: 'link' },
        { text: ': 在文件末尾追加新的一行 ' },
        { text: w, style: 'code' },
        { text: '，保持文件以换行符结尾（与现有各行格式一致），不修改任何已有内容。' },
      ],
    },
  ];
  if (withCommit) {
    blocks.push({
      kind: 'bullet',
      segments: [
        { text: '提交：改动完成后需创建一次 commit，遵循仓库历史惯例（如 ' },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        { text: '），本次 commit message 使用 ' },
        { text: msg, style: 'code' },
        { text: '。' },
      ],
    });
  }
  blocks.push(
    { kind: 'head', segments: [{ text: '验证' }] },
    {
      kind: 'bullet',
      segments: [
        { text: '执行 ' },
        { text: 'cat README.md', style: 'code' },
        { text: ' 或 ' },
        { text: 'tail -1 README.md', style: 'code' },
        { text: '，确认最后一行为 ' },
        { text: w, style: 'code' },
        { text: '。' },
      ],
    },
    {
      kind: 'bullet',
      segments: [
        { text: '执行 ' },
        { text: 'git diff README.md', style: 'code' },
        { text: '，确认只新增了一行 ' },
        { text: `+${w}`, style: 'code' },
        { text: '，没有改动其他内容。' },
      ],
    },
  );
  return blocks;
}

const DYNAMIC = 'r8 dynamic probe';
const MANUAL = 'r8 probe manual-revision';
const MSG_DYNAMIC = 'docs(readme): append r8 dynamic probe line';
const MSG_MANUAL = 'docs(readme): append r8 probe manual-revision line';

const DOC_V1 = planDoc(DYNAMIC, false, MSG_DYNAMIC);
const DOC_V2 = planDoc(DYNAMIC, true, MSG_DYNAMIC);
const DOC_V3 = planDoc(MANUAL, true, MSG_MANUAL);

/** Plan-card preview line of the #15 plan cards (r8 63/68/73/76): the
 *  two-line clamp cut lands before the version wording, so every version
 *  shares this truncation, ellipsis included. */
const R8_PLAN_PREVIEW =
  'Context 仓库根目录的 README.md 目前内容为逐行累积的"探针记录"（r3 lifecycle probe、r6 rebaseline probe、r7 rebaseline probe 等），每次任务在文件末尾新增一行文字，文件以换行符结尾。本次任务按同样的惯例，在文件末尾…';

/** plan.md line list per version (diff source of truth). */
function planLines(w: string, msg: string | null): string[] {
  return [
    '## Context',
    `仓库根目录的 README.md 目前内容为逐行累积的"探针记录"（r3 lifecycle probe、r6 rebaseline probe、r7 rebaseline probe 等），每次任务在文件末尾新增一行文字，文件以换行符结尾。本次任务按同样的惯例，在文件末尾追加一行 ${w}。`,
    '',
    '## 改动',
    `- README.md: 在文件末尾追加新的一行 ${w}，保持文件以换行符结尾（与现有各行格式一致），不修改任何已有内容。`,
    ...(msg != null
      ? [
          `- 提交：改动完成后需创建一次 commit，遵循仓库历史惯例（如 docs(readme): append r7 rebaseline probe line），本次 commit message 使用 ${msg}。`,
        ]
      : []),
    '',
    '## 验证',
    `- 执行 cat README.md 或 tail -1 README.md，确认最后一行为 ${w}。`,
    `- 执行 git diff README.md，确认只新增了一行 +${w}，没有改动其他内容。`,
  ];
}

const NO_NEWLINE = '\\ No newline at end of file';

/** Unified hunk between two plan.md line lists (single hunk, full file).
 *  The trailing no-newline marker rides per side when both sides change
 *  at EOF (r8 72: del marker between the last del and the first add). */
function planHunk(from: string[], to: string[]): DiffHunk {
  // 01-stack-v2 §4.1 pins the diff data layer to npm `diff` 9.0.0 (render
  // stays hand-rolled); the fixture hunks go through the same pin.
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const part of diffLines(from.join('\n'), to.join('\n'))) {
    const rows = part.value.split('\n');
    if (rows[rows.length - 1] === '') rows.pop(); // trailing join separator
    for (const text of rows) {
      if (part.added === true) {
        newNo++;
        lines.push({ kind: 'add', text, newNo });
      } else if (part.removed === true) {
        oldNo++;
        lines.push({ kind: 'del', text, oldNo });
      } else {
        oldNo++;
        newNo++;
        lines.push({ kind: 'context', text, oldNo, newNo });
      }
    }
  }
  // r8 72 renders the no-newline marker per side when both sides change
  // at EOF; add-only diffs (r8 66) carry the single trailing marker
  const lastDel = lines.findLastIndex((l) => l.kind === 'del');
  const firstAdd = lines.findIndex((l) => l.kind === 'add');
  if (lastDel !== -1 && lastDel > firstAdd) {
    lines.splice(lastDel + 1, 0, { kind: 'marker', text: NO_NEWLINE });
  }
  return {
    header: `@@ -1,${from.length} +1,${to.length} @@`,
    lines: [...lines, { kind: 'marker', text: NO_NEWLINE }],
  };
}

/** plan-version diff surface (r8 65–72): one plan.md file, stats derived
 *  from the hunk. */
function planDiff(
  fromV: string,
  toV: string,
  from: string[],
  to: string[],
  expanded: boolean,
): PlanDiffContent {
  const hunk = planHunk(from, to);
  const added = hunk.lines.filter((l) => l.kind === 'add').length;
  const removed = hunk.lines.filter((l) => l.kind === 'del').length;
  return {
    from: fromV,
    to: toV,
    expanded,
    // #244 全文槽:to 版本 plan.md 全文(与 hunk 同源,LINES 数组即版本内容);
    // 初渲不展示,视觉零影响。
    files: [{ path: 'plan.md', added, removed, hunks: [hunk], fullContent: to.join('\n') }],
  };
}

const LINES_V1 = planLines(DYNAMIC, null);
const LINES_V2 = planLines(DYNAMIC, MSG_DYNAMIC);
const LINES_V3 = planLines(MANUAL, MSG_MANUAL);

/** AI-review message of run 1 (r8 60/65): conclusion-first prose, one
 *  numbered blocking finding, the quoted plan line, closing paragraph. */
const REVIEW_MESSAGE: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    { segments: [{ text: '看好还是坏，直接给结论：' }] },
    { segments: [{ text: 'Please address the points below before coding.' }] },
    {
      ordinal: 1,
      segments: [
        {
          text: '计划完全没有提到提交(commit)这一步。仓库历史显示每次追加探针行都伴随一次格式统一的 commit(如 ',
        },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        {
          text: ')，但计划的"改动"和"验证"部分只字未提是否要创建对应的 commit、以及 commit message 应遵循什么格式。请在计划中补充：追加该行后是否需要提交，若需要，commit message 按照惯例应为类似 ',
        },
        { text: 'docs(readme): append r8 dynamic probe line', style: 'code' },
        { text: ' 的格式。(blocking)' },
      ],
    },
    {
      quote: true,
      segments: [
        { text: 'README.md', style: 'code' },
        { text: '：在文件末尾追加新的一行 ' },
        { text: DYNAMIC, style: 'code' },
        { text: '，保持文件以换行符结尾（与现有各行格式一致），不修改任何已有内容。' },
      ],
    },
    {
      segments: [
        {
          text: '除此之外，计划本身与现有文件内容、格式惯例(每行探针记录、文件以换行符结尾)完全吻合，没有其他问题。',
        },
      ],
    },
  ],
  footer: { seconds: 53 },
};

/** Auto-revision summary after the blocking finding (r8 61/65). */
const ADJUST_V2_MESSAGE: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    {
      segments: [
        { text: '确认历史提交惯例后，补充 commit 相关说明到计划中。已按反馈补充：查看 ' },
        { text: 'git log --oneline -- README.md', style: 'code' },
        { text: ' 确认历史上每次追加探针行都有对应 commit（如 ' },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        { text: '），在「改动」部分新增一条，明确本次需提交一次 commit，message 为 ' },
        { text: MSG_DYNAMIC, style: 'code' },
        { text: '。' },
      ],
    },
  ],
};

/** Manual-reject revision summary (r8 68). */
const ADJUST_V3_MESSAGE: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    {
      segments: [
        {
          text: '用户明确要求把追加行文案改为「r8 probe manual-revision」，需要同步更新计划中所有引用该文案的地方（Context、改动、验证），以保持一致；commit message 中的描述性文字也随之同步（因为它直接引用了追加内容，若不改会与实际内容不符），其余结构和逻辑不变。已按用户要求将追加行文案统一改为「r8 probe manual-revision」，同步更新了 Context、改动（含 commit message）和验证三处，其余结构不变。',
        },
      ],
    },
  ],
};

const REJECT_FEEDBACK = '请把追加行的文案改为「r8 probe manual-revision」，其余不变';

/** Run-1 transcript of #15 up to the v2 plan card (r8 62/63). */
const RUN1_TO_V2: TranscriptItem[] = [
  { kind: 'run', at: '23:40', machine: MACHINE_NAME },
  { kind: 'user', text: '开始执行任务', seq: 15, title: R8_TITLE },
  {
    kind: 'robot',
    paragraphs: [
      {
        segments: [{ text: '任务明确：在 README.md 末尾追加探针行，直接规划。' }],
      },
    ],
  },
  { kind: 'plan', title: '方案 · v1', preview: R8_PLAN_PREVIEW, seconds: 31 },
  { kind: 'note', text: 'Xmon Dai 发起了 AI 审核' },
  REVIEW_MESSAGE,
  ADJUST_V2_MESSAGE,
  { kind: 'plan', title: '方案 · v2', preview: R8_PLAN_PREVIEW, seconds: 29 },
];

/** v2 landed (r8 63–66): run-1 transcript, version dropdown rows. */
function detailV2(now: number): FixtureSet {
  return {
    todos: [failed12, review13, probe15('confirm', r8(23, 53))],
    now,
    detail: {
      transcript: RUN1_TO_V2,
      doc: DOC_V2,
      planVersions: [
        { v: 'v2', at: r8(23, 53) },
        { v: 'v1', at: r8(23, 44) },
      ],
    },
  };
}

/** v3 landed (r8 68–72): reject bubble + v3 summary + v3 card; the open
 *  diff auto-rebased to v1 → v3 (r8 §2.7). */
const RUN1_TO_V3: TranscriptItem[] = [
  ...RUN1_TO_V2,
  { kind: 'user', text: REJECT_FEEDBACK },
  ADJUST_V3_MESSAGE,
  { kind: 'plan', title: '方案 · v3', preview: R8_PLAN_PREVIEW, seconds: 49 },
];

function detailV3(now: number): FixtureSet {
  return {
    todos: [failed12, review13, probe15('confirm', r8(23, 56))],
    now,
    detail: {
      transcript: RUN1_TO_V3,
      doc: DOC_V3,
      planVersions: [
        { v: 'v3', at: r8(23, 56) },
        { v: 'v2', at: r8(23, 53) },
        { v: 'v1', at: r8(23, 44) },
      ],
      planDiff: planDiff('v1', 'v3', LINES_V1, LINES_V3, false),
    },
  };
}

/** #15 failed (r8 73–75): v3 round confirmed, execution merged-failed. */
const RUN1_FAILED: TranscriptItem[] = [
  ...RUN1_TO_V3,
  { kind: 'user', text: '确认' },
  {
    kind: 'robot',
    paragraphs: [
      {
        segments: [
          { text: '已在 ' },
          { text: 'README.md', style: 'code' },
          { text: ' 末尾追加一行 ' },
          { text: MANUAL, style: 'code' },
          { text: '，验证通过：' },
          { text: 'tail -1', style: 'code' },
          { text: ' 与 ' },
          { text: 'git diff', style: 'code' },
          { text: ' 均确认仅新增该行，其余内容未改动。' },
        ],
      },
    ],
    footer: { seconds: 29 },
  },
  { kind: 'note', text: 'Xmon Dai 发起了合并' },
  {
    kind: 'fail',
    title: '运行该任务的机器已离线',
    body: '请将其重新上线，或重新运行任务以改派其他机器。',
    links: ['查看原始错误', '排查指南'],
  },
];

function detailFailed15(now: number): FixtureSet {
  return {
    todos: [failed12, probe15('failed', r8n(0, 0))],
    now,
    detail: { transcript: RUN1_FAILED, changes: CHANGES_15 },
  };
}

/** Reused build (r8 76): skipped planning, quoted plan card, second run
 *  stamp split around it, 确认 round streaming. */
const REUSED_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '00:02' },
  { kind: 'user', text: '开始执行任务', seq: 15, title: R8_TITLE },
  { kind: 'robot', paragraphs: [{ segments: [{ text: '复用了上一次运行的方案。' }] }] },
  { kind: 'plan', title: '方案 · v1', preview: R8_PLAN_PREVIEW },
  { kind: 'run', machine: MACHINE_NAME },
  { kind: 'user', text: '确认' },
  { kind: 'streaming', seconds: 1, label: '连接机器...' },
];

/** Reused build once it reached review (r8 77 background). */
const REUSED_REVIEW_TRANSCRIPT: TranscriptItem[] = [
  ...REUSED_TRANSCRIPT.slice(0, 5),
  {
    kind: 'robot',
    paragraphs: [
      {
        segments: [
          {
            text: '已在 README.md 末尾追加一行 r8 dynamic probe（任务标题要求的具体文字，与之前计划中占位的 ',
          },
          { text: MANUAL, style: 'code' },
          { text: ' 不同，故以任务标题为准），' },
          { text: 'git diff', style: 'code' },
          { text: ' 确认仅新增了这一行，未改动其他内容。' },
        ],
      },
    ],
    footer: { seconds: 49 },
  },
];

// ---- scenario sets ----

/** Detail-content patch helper: keeps the r8 scenario sets free of
 *  non-null assertions on the optional `detail` field. */
function withDetail(
  base: FixtureSet,
  patch: Partial<NonNullable<FixtureSet['detail']>>,
): FixtureSet {
  const detail = base.detail;
  if (detail == null) return base;
  return { ...base, detail: { ...detail, ...patch } };
}

/** r8 54/56: #12 failed detail, evening now. */
export const detailFailed12: FixtureSet = {
  todos: [failed12, review13],
  now: r8(23, 14),
  detail: { transcript: transcript12('17:38'), changes: CHANGES_12 },
};

/** r8 55: board with the failed #12 card in 执行中. */
export const boardFailed: FixtureSet = {
  todos: [failed12, review13],
  now: r8(23, 14),
  schedules: [],
  project: projectContent,
};

/** r8 56: rerun dialog over #12 (no plan doc → no 复用方案 button)。
 *  #640：dialog 瘦身形（说明行 + 重跑；agent 行/分用开关/双分支已撤销）。 */
export const rerunDialog12: FixtureSet = {
  ...detailFailed12,
  overlay: { kind: 'rerun' },
};

/** r8 57: run history of #12 past midnight (昨天 stamp, 6 小时前 row).
 *  Rows ride the upstream overlayContent mechanism (#68); #366 freezes the
 *  right pane on the history section instead of opening a dialog. */
export const history12: FixtureSet = {
  ...detailFailed12,
  ui: { paneView: 'history' },
};

/** #366 AC 钉面（无 capture，smoke scenario）：review 变更面 + 线程内折叠
 *  plan 卡行——plan 卡激活入口（右 pane 切文档面 plan 显示面）需要「变更面
 *  + 线程含 plan 卡」的组合面，r7/r8 捕获均无此组合。 */
export const planOpenReview: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: [
      { kind: 'plan', title: '方案 · v1', preview: R8_PLAN_PREVIEW },
      ...PROBE_BUILD_OPEN,
      PROBE_BUILD_RESULT,
    ],
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** #469 named scenario (no capture, planOpenReview precedent): the chat
 *  surface that exercises the two block-rendering paths — an agent reply
 *  carrying raw block markdown (heading / ordered+unordered nested lists /
 *  code fence / inline code) and a tool group whose bash stdout renders as
 *  left-aligned mono blocks instead of flattening into `.chat-note`. The
 *  robot message holds `markdown` (parsed at render time by
 *  chat-markdown.tsx), so this fixture drives the same parse+render path
 *  as the live mapper. */
const MD_SAMPLE = [
  '## 检查结果',
  '',
  '仓库根目录内容如下，运行 `ls -la` 的输出已折叠在上方工具行。',
  '',
  '1. 第一步：确认目录',
  '   - 子项 A',
  '   - 子项 B',
  '2. 第二步：打印问候',
  '',
  '- 顶层要点',
  '  - 嵌套要点',
  '',
  '```sh',
  'total 16',
  'drwxr-xr-x  4 xmon  staff  128 Sep 30 10:00 .',
  '```',
].join('\n');

const MD_TOOL_PILLS = ['bash ls -la', 'bash echo "hello from pacman"'];
const MD_TOOL_OUTPUTS = [
  'total 16\ndrwxr-xr-x@ 4 xmon  staff  128 Sep 30 10:00 .\ndrwxr-xr-x@ 6 xmon  staff  192 Sep 30 09:00 ..',
  'hello from pacman',
];

const MD_TOOLOUT_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  {
    kind: 'user',
    text: '列出仓库根目录并打印一句问候',
    seq: 9,
    title: '在 README.md 末尾追加一行「r7 rebaseline probe」',
  },
  {
    kind: 'tools',
    seconds: 19,
    expanded: false,
    pills: MD_TOOL_PILLS,
    outputs: MD_TOOL_OUTPUTS,
  },
  { kind: 'robot', markdown: MD_SAMPLE, footer: { seconds: 12 } },
];

export const mdToolout: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: MD_TOOLOUT_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** #919 named scenario（无 capture，mdToolout 先例）：技能路由行为验收的
 *  UI 面钉扎 #918 落地的那张脸（并行票先合，本票 seam 4 的验收对象即它）：
 *  活行披露面的技能事实行（▶ 命中 / ✕ 挡下）+ 持久汇总行（技能/挡下两列）。
 *  场景词表与行为证据腿同款（haiku 命中 + secret 挡下）。 */
const SKILLS_ROUTING_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  {
    kind: 'user',
    text: '写一首深夜写代码主题的三行俳句，保存到 haiku.txt',
    seq: 9,
    title: '写一首俳句并保存',
  },
  { kind: 'skills', read: ['haiku-helper'], denied: ['secret-local'] },
  {
    kind: 'robot',
    paragraphs: [[{ text: '已把俳句写进 haiku.txt。' }]],
    footer: { seconds: 12 },
  },
];

export const skillsRouting: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: SKILLS_ROUTING_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** #1106 named scenario（无 capture，skills-routing 先例）：派发技能注入
 *  回查行（详情面持久一份）的渲染钉扎——live 面由 mapTranscript 从
 *  step.skillInjection 派生（unit：injected-skills-row.test.ts + live 探针
 *  docs/verify/1106/）；fixture 捕获面无 step 数据源，行以冻结 view item
 *  直供本场景钉渲染缝（行形/原因随行/零命中占位）。 */
const SKILL_INJECT_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  {
    kind: 'injected-skills',
    skills: [
      {
        id: 'better-typography',
        reason: '任务文本与技能同域「前端界面」（任务命中「字号」，技能描述命中「ui」）',
      },
      { id: 'tdd', reason: '任务文本显式点名「tdd」' },
    ],
  },
  {
    kind: 'user',
    text: '修复看板卡片的字号过小与换行溢出',
    seq: 9,
    title: '字号与换行修复',
  },
  {
    kind: 'robot',
    paragraphs: [[{ text: '已修复字号与换行。' }]],
    footer: { seconds: 12 },
  },
];

/** 零命中对照面：已计算零命中的行 = 「未注入技能」占位（配置事实可见，
 *  不是行缺席——与 skills-routing 的零噪声对照（27 场景）语义相反）。 */
const SKILL_INJECT_ZERO_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  { kind: 'injected-skills', skills: [] },
  {
    kind: 'user',
    text: '把首页轮播图换成静态图',
    seq: 10,
    title: '轮播图静态化',
  },
];

export const skillInject: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: SKILL_INJECT_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

export const skillInjectZero: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: SKILL_INJECT_ZERO_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** r8 63: version dropdown open on the v2 surface. */
export const versionMenuV2: FixtureSet = withDetail(detailV2(r8(23, 54)), {
  versionMenu: 'versions',
  compareTarget: planDiff('v1', 'v2', LINES_V1, LINES_V2, false),
});

/** r8 64: compare submenu open (single 上一版本 row). */
export const compareMenuV2: FixtureSet = withDetail(detailV2(r8(23, 54)), {
  versionMenu: 'compare',
  compareTarget: planDiff('v1', 'v2', LINES_V1, LINES_V2, false),
});

/** r8 65/66: plan-version diff v1 → v2, collapsed / expanded. */
export function diffV1V2(expanded: boolean): FixtureSet {
  return withDetail(detailV2(r8(23, 55)), {
    planDiff: planDiff('v1', 'v2', LINES_V1, LINES_V2, expanded),
  });
}

/** r8 67: reject sent — replan streaming with the v1 → v2 diff still open. */
export const revisionStreaming: FixtureSet = {
  todos: [failed12, review13, probe15('planning', r8(23, 55))],
  now: r8(23, 55),
  detail: {
    transcript: [
      ...RUN1_TO_V2,
      { kind: 'user', text: REJECT_FEEDBACK },
      { kind: 'streaming', seconds: 1, label: '处理中...' },
    ],
    doc: DOC_V2,
    planVersions: [
      { v: 'v2', at: r8(23, 53) },
      { v: 'v1', at: r8(23, 44) },
    ],
    planDiff: planDiff('v1', 'v2', LINES_V1, LINES_V2, true),
  },
};

/** r8 68/69: v3 landed, auto-rebased v1 → v3 diff collapsed. */
export const detailV3Collapsed: FixtureSet = detailV3(r8(23, 58));

/** r8 70: version dropdown open over the v3 diff surface (5 rows: the
 *  open diff adds the compare row's `v1` label + 回到与 base 对比). */
export const versionMenuV3: FixtureSet = withDetail(detailV3(r8(23, 58)), {
  versionMenu: 'versions',
  compareTarget: planDiff('v2', 'v3', LINES_V2, LINES_V3, false),
});

/** r8 71/72: manual-reject diff v2 → v3, collapsed / expanded. */
export function diffV2V3(expanded: boolean): FixtureSet {
  return withDetail(detailV3(r8(23, 58)), {
    planDiff: planDiff('v2', 'v3', LINES_V2, LINES_V3, expanded),
  });
}

/** r8 73: #15 failed detail. */
export const detailFailed15Set: FixtureSet = detailFailed15(r8n(0, 1));

/** r8 74: rerun dialog with the 复用方案 button (#15 has a plan doc)。
 *  #640：dialog 瘦身形（重跑降 ghost 次钮 + indigo 复用方案）。 */
export const rerunDialog15: FixtureSet = {
  ...detailFailed15(r8n(0, 1)),
  overlay: { kind: 'rerun' },
};

/** r8 75: 复用方案 sub-panel. */
export const reusePanel15: FixtureSet = {
  ...detailFailed15(r8n(0, 1)),
  overlay: { kind: 'reuse' },
};

/** r8 76: reused build streaming (执行中, plan pane on the reused v1). */
export const reusedBuilding: FixtureSet = {
  todos: [failed12, review13, probe15('building', r8n(0, 2))],
  now: r8n(0, 2),
  detail: { transcript: REUSED_TRANSCRIPT, doc: DOC_V3 },
};

/** r8 77: run history of the reused build, two rows, review phase. */
export const history15: FixtureSet = {
  todos: [failed12, review13, probe15('review', r8n(0, 2))],
  now: r8n(0, 3),
  detail: { transcript: REUSED_REVIEW_TRANSCRIPT, changes: CHANGES_15 },
  ui: { paneView: 'history' },
};

/** Interactive reject chain (issue #75 AC3): confirm v1 with a revision
 *  script — send walks 请求修改 → streaming → v2 → diff → 确认. */
export const revisionChain: FixtureSet = {
  todos: [failed12, review13, probe15('confirm', r8(23, 44))],
  now: r8(23, 45),
  detail: {
    transcript: RUN1_TO_V2.slice(0, 4),
    doc: DOC_V1,
    planVersions: [{ v: 'v1', at: r8(23, 44) }],
    revision: {
      feedback: REJECT_FEEDBACK,
      streaming: { seconds: 1, label: '处理中...' },
      landed: {
        planVersions: [
          { v: 'v2', at: r8(23, 45) },
          { v: 'v1', at: r8(23, 44) },
        ],
        doc: DOC_V2,
        transcriptTail: [
          ADJUST_V2_MESSAGE,
          {
            kind: 'plan',
            title: '方案 · v2',
            preview: R8_PLAN_PREVIEW,
            seconds: 29,
          },
        ],
        planDiff: planDiff('v1', 'v2', LINES_V1, LINES_V2, false),
      },
    },
  },
};

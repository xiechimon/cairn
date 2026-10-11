import { boardMachinePicker } from './board.js';
import { legacyDone, legacyReview, MACHINE_ID, MACHINE_NAME, r7 } from './core.js';
import type {
  ChiefContent,
  ChiefExample,
  ChiefSettingsTab,
  ChiefThreadRef,
  FixtureSet,
} from './records.js';

// ── Chief surfaces (issue #72, r5 100–116) ───────────────────────────────
// Copy verbatim from the r5 captures: 100 gate bar + hero + draft, 101–104
// settings tabs, 111 bound hero, 114 dispatch-report stream, 116 switcher.
// The r5 batch is 1438×730 (off the r7 baseline batch), so these sets back
// smoke rows only — see docs/research/r8-chief-panel-adhoc.md for the
// baseline gap registration.

/** r5 100/111 hero grid, card order = capture order. */
export const CHIEF_EXAMPLES: ChiefExample[] = [
  { icon: 'user-plus', text: '帮我组建 Agent 团队' },
  { icon: 'folder', text: '帮我创建一个新项目' },
  { icon: 'grid', text: '总结一下我所有项目现在的进展' },
  { icon: 'bars', text: '查一下这个月的 token 用量' },
];

/** r5 100/111 composer draft (localStorage pacman.cache.chief-draft-v1, the
 *  capture shows it restored into the textarea). */
const CHIEF_DRAFT =
  '我想做一个能在浏览器里直接玩的网页小游戏 （比如贪吃蛇或打砖块）： 单文件 HTML + Canvas， 不用任何构建工具，做完能在项目的文件页直接试玩。请在现有的入门项目里做， 组建 Agent 团队把游戏逻辑、 画面手感、 难度调优拆成并行任务， 然后向我汇报方案， 等我确认后再开始动工。';

/** r5 116 switcher rows: the two threads of the r5 session, active first. */
const CHIEF_THREADS: ChiefThreadRef[] = [
  { title: '给 r3-lifecycle 做三件小事…', active: true },
  { title: '帮 r3-lifecycle 写一份…' },
];

/** r5 100: drawer on a fresh thread, no agent bound — gate bar + hero. */
export const chiefGated: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: false,
    threadTitle: '新主题',
    examples: CHIEF_EXAMPLES,
    draft: CHIEF_DRAFT,
  },
};

/** r5 111: same fresh-thread drawer once an agent is bound — model slot
 *  filled, gate bar gone. */
export const chiefReady: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '新主题',
    examples: CHIEF_EXAMPLES,
    draft: CHIEF_DRAFT,
  },
};

/** r5 113: 回合进行中流式面（#624 命名场景，手法循 #499/#444 无 capture
 *  先例）——testA 线程发出后 Chief 在仓库基座跑 git 只读探索（doc §2 实测
 *  工具行 `git show`），回合未收尾：robot 行无 `完成 Ns` 徽标（seconds 空串
 *  = live 流式同形），composer 占位切 steer canon（running 位）。线程标题 =
 *  首句 12 字截断 + …（shared chiefThreadTitle 律）。流内容 [推断]：capture
 *  仅工具行与占位词可辨（截图 113），拼装循 114 族；捕获面的 `停止` 钮属
 *  live 停止链，另票裁决不入本景。 */
export const chiefStreaming: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '我想做一个能在浏览器里直…',
    running: true,
    stream: [
      { kind: 'note', text: '17:19' },
      { kind: 'note', text: '运行在 ', machineName: MACHINE_NAME },
      { kind: 'user', text: CHIEF_DRAFT },
      {
        kind: 'robot',
        paragraphs: [
          [
            {
              text: '收到。我先读一遍现有入门项目的结构，再把游戏逻辑、画面手感、难度调优拆成并行任务向你汇报方案。',
            },
          ],
        ],
        seconds: '',
        tools: [{ label: 'git show' }],
      },
    ],
  },
};

/** r5 114: thread view with the dispatch report of todo #11 — user bubble,
 *  chief report paragraphs with the #11 / r5-scribe chips, 完成 44s footer. */
export const chiefThread: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '帮 r3-lifecycle 写一份…',
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'note', text: '运行在 ', machineName: MACHINE_NAME },
      {
        kind: 'user',
        text: '帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南，说明怎么给 Agent 提任务、怎么验收改动，写完放到项目根目录。',
      },
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '已创建并派工 ' },
            { text: '', todo: 11 },
            { text: ' 「编写 CONTRIBUTING.md 贡献指南」， 由文档专职 Agent ' },
            { text: '', agent: 'r5-scribe' },
            { text: ' 承接，正在编写中。' },
          ],
          [
            {
              text: '要求内容涵盖：如何给 Agent 提任务、如何验收改动，文件写入项目根目录 CONTRIBUTING.md。完成或需要确认时我会跟进汇报。',
            },
          ],
        ],
        seconds: '44s',
        // #615 返工：foot 折叠箭头展开面（r5 114 捕获为折叠态，展开内容未
        // 采——工具行 [推断] 自回执文本「已创建并派工 #11 … 承接」）。
        tools: [
          { label: 'create_todo', seconds: 2 },
          { label: 'run_builds', seconds: 5 },
        ],
      },
    ],
  },
};

/** r5 116: the 三件小事 thread with the header switcher popover open —
 *  the visible stream tail is the merge-check report (bullets + #12 ask). */
export const chiefThreadsOpen: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
    threadsOpen: true,
    threads: CHIEF_THREADS,
    stream: [
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '顺带说明： CONTRIBUTING.md 本身由 ' },
            { text: '', todo: 11 },
            {
              text: ' 负责编写，目前在 review 阶段尚未合并进 main，我在新任务里已注明"只需在 README 里列出该条目，不必等它合并"。',
            },
          ],
          [{ text: '等它落到 review/完成时我会来汇报，到时候也会补上记忆总结。' }],
        ],
        seconds: '1m 4s',
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '三项改动都已核对，符合要求：' }]],
        bullets: [
          [
            { text: 'README.md:', strong: true },
            { text: '新增 「文档目录」 节，列出 ' },
            { text: 'CONTRIBUTING.md', code: true },
            { text: ' 链接。' },
          ],
          [
            { text: 'CHANGELOG.md:', strong: true },
            { text: '新建,含 「未发布」 初始条目，列出本次三项变更。' },
          ],
          [
            { text: 'scripts/hello.js:', strong: true },
            { text: 'node scripts/hello.js', code: true },
            { text: ' 打印 ' },
            { text: 'hello', code: true },
            { text: '，构建里已本地验证过。' },
          ],
        ],
        seconds: '31s',
      },
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '', todo: 12 },
            { text: ' 现在停在 review 阶段等你确认合并。要我现在 merge 吗?' },
          ],
        ],
        seconds: '31s',
      },
    ],
  },
};

/** #1094 长列表滚动面（synthetic scenario，chief-md 先例）：r5 116 的
 *  切换器形态 + 22 行线程（canon 两行在前，active 仍钉首行）。修复前
 *  容器零 max-height，尾部行被 WINDOW_CLS 的 overflow-hidden 裁掉——
 *  不可见也不可点；e2e/chief-thread-switcher-scroll.spec 钉封顶 +
 *  纵向滚动可达 + 尾部行可点，短列表面（116）零变化对照。 */
const CHIEF_THREADS_LONG: ChiefThreadRef[] = [
  ...CHIEF_THREADS,
  ...Array.from({ length: 20 }, (_, i) => ({ title: `长列表主题 ${i + 1}` })),
];

export const chiefThreadsLong: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
    threadsOpen: true,
    threads: CHIEF_THREADS_LONG,
    stream: [
      {
        kind: 'robot',
        paragraphs: [[{ text: '三项改动都已核对，符合要求：' }]],
        seconds: '31s',
      },
    ],
  },
};

/** #650/#651 named scenario (no capture, mdToolout / chiefStreaming 先例):
 *  总管抽屉的 markdown 面——定稿 robot 行携带 raw block markdown（`markdown`
 *  槽优先于段数组，渲染期走共用 chat-markdown 解析，live mapper 同路），
 *  尾行 = typing 打字面（`typing` 位，无 foot；静态表达 live 流式态，
 *  scenario 113 的 running 位同手法）。e2e/chief-stream-markdown.spec 钉
 *  bold/code/mention/列表/栅栏的渲染形与「星号不漏字面」。 */
const CHIEF_MD_REPLY = [
  '## 凭证链路验证报告',
  '',
  '三项检查已完成，**全部通过**，输出细节在 `docs/verify/` 目录。',
  '',
  '- **项目**: 凭证链路验证',
  '- 次要点: 由 [r5-scribe](agent:a1) 承接复核',
  '- 关联任务: [#1](todo:r3-legacy-1) 已进入复核；prose #12 与 [伪链](todos:t2) 保持字面',
  '',
  '1. 第一步：读取配置',
  '   - 子项：token 门',
  '2. 第二步：跑通探针',
  '',
  '```sh',
  'curl -s localhost:8787/healthz',
  '```',
].join('\n');

export const chiefMarkdown: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '验证一下凭证链路…',
    running: true,
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'user', text: '验证一下凭证链路，然后给我一份报告' },
      {
        kind: 'robot',
        markdown: CHIEF_MD_REPLY,
        seconds: '44s',
      },
      {
        kind: 'robot',
        markdown: '正在复核 **relay 通道** 的重试预算',
        typing: true,
        seconds: '',
      },
    ],
  },
};

/** r5 101–104: the 总管设置 view, one set per tab (unbound agent). */
export function chiefSettings(tab: ChiefSettingsTab): FixtureSet {
  return {
    todos: [legacyReview, legacyDone],
    now: r7(13, 14),
    chief: { view: 'settings', tab, bound: false, threadTitle: '新主题' },
  };
}

/** #358 AC2 canon（spec 11 §A10）：compactionModel 仍引用已废 preset
 *  （`anthropic` ∈ PROVIDER_PRESET_IDS，preset 方案退役后不再是选项来源），
 *  命中不了 fixture canon 单行（#770 起为 claude-code 行）→ 选择器落裸串
 *  `provider/modelId`
 *  兜底回显，不空白不崩。scenario = 101-stale-model。 */
export const chiefSettingsStaleModel: FixtureSet = {
  ...chiefSettings('agent'),
  chief: {
    view: 'settings',
    tab: 'agent',
    bound: false,
    threadTitle: '新主题',
    compactionModel: { provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022' },
  },
};

/** #895 主力机槽命名场景（无 capture，101-stale-model 先例）：settings
 *  Agent tab + resources 两机（在线本机 + 离线远端，boardMachinePicker 同
 *  行集）+ 槽值钉本机——e2e 钉机器 chip 的回显/清单/accept 律。 */
export const chiefSettingsMachines: FixtureSet = {
  ...chiefSettings('agent'),
  resources: boardMachinePicker.resources,
  chief: {
    view: 'settings',
    tab: 'agent',
    bound: false,
    threadTitle: '新主题',
    machineId: MACHINE_ID,
  },
};

/** Default drawer content for a FAB-opened drawer on a scenario without a
 *  chief surface (dev interactivity; fixture rows always carry a set). */
export const chiefDefault: ChiefContent = {
  view: 'drawer',
  bound: false,
  threadTitle: '新主题',
  examples: CHIEF_EXAMPLES,
};

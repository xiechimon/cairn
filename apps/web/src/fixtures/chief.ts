import { at, legacyDone, legacyReview, MACHINE_NAME, R3_DAY, r7 } from './core.js';
import type {
  ChiefContent,
  ChiefStreamItem,
  ChiefThreadRef,
  FixtureSet,
  TodoRecord,
} from './records.js';

const contributingGuide: TodoRecord = {
  ...legacyReview,
  id: 'r3-contributing',
  title: '编写 CONTRIBUTING.md 贡献指南',
  spec: '编写 CONTRIBUTING.md 贡献指南，放到项目根目录。',
  phase: 'building',
  phaseAt: at(R3_DAY, 17, 27),
  seqNum: 11,
  orderIndex: 2,
};

const CHIEF_DRAFT =
  '我想做一个能在浏览器里直接玩的网页小游戏 （比如贪吃蛇或打砖块）： 单文件 HTML + Canvas， 不用任何构建工具，做完能在项目的文件页直接试玩。请在现有的入门项目里做， 组建 Agent 团队把游戏逻辑、 画面手感、 难度调优拆成并行任务， 然后向我汇报方案， 等我确认后再开始动工。';

const CHIEF_THREADS: ChiefThreadRef[] = [
  { title: '给 r3-lifecycle 做三件小事…', active: true },
  { title: '帮 r3-lifecycle 写一份…' },
];

export const chiefGated: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: false,
    threadTitle: '新主题',
    draft: CHIEF_DRAFT,
  },
};

export const chiefReady: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '新主题',
    draft: CHIEF_DRAFT,
  },
};

export const chiefStreaming: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '我想做一个能在浏览器里直…',
    running: true,
    stream: [
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

const streamingChief = chiefStreaming.chief as ChiefContent;

export const chiefWorking: FixtureSet = {
  ...chiefStreaming,
  chief: {
    ...streamingChief,
    stream: [
      ...(streamingChief.stream ?? []),
      { kind: 'streaming', seconds: 72, label: '处理中…' },
    ],
  },
};

export const chiefThread: FixtureSet = {
  todos: [legacyReview, legacyDone, contributingGuide],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '帮 r3-lifecycle 写一份…',
    stream: [
      { kind: 'note', text: '运行在 ', machineName: MACHINE_NAME },
      {
        kind: 'user',
        text: '帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南，说明怎么给 Agent 提任务、怎么验收改动，写完放到项目根目录。',
      },
      {
        kind: 'robot',
        paragraphs: [
          [{ text: '已创建并派工 ' }, { text: '', todo: 11 }, { text: '，正在编写中。' }],
          [
            {
              text: '要求内容涵盖：如何给 Agent 提任务、如何验收改动，文件写入项目根目录 CONTRIBUTING.md。完成或需要确认时我会跟进汇报。',
            },
          ],
        ],
        seconds: '44s',
        tools: [
          { label: 'create_todo', seconds: 2 },
          { label: 'run_builds', seconds: 5 },
        ],
      },
      {
        kind: 'task-card',
        id: 'r3-contributing-card',
        todoId: contributingGuide.id,
        projectId: contributingGuide.projectId,
        seq: contributingGuide.seqNum,
        title: contributingGuide.title,
      },
    ],
  },
};

export const chiefThreadsOpen: FixtureSet = {
  todos: [legacyReview, legacyDone, { ...contributingGuide, phase: 'review' }],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
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

const CHIEF_THREADS_LONG: ChiefThreadRef[] = [
  ...CHIEF_THREADS,
  ...Array.from({ length: 20 }, (_, i) => ({ title: `长列表主题 ${i + 1}` })),
];

export const chiefThreadsLong: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
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

const CHIEF_SCROLL_ROWS: ChiefStreamItem[] = Array.from({ length: 40 }, (_, i) =>
  i % 2 === 0
    ? { kind: 'user', text: `滚动保留探针第 ${i + 1} 条：检查滚动位置是否存活。` }
    : {
        kind: 'robot',
        paragraphs: [
          [
            {
              text: `第 ${i + 1} 条回执：这条只负责撑高消息流，让滚动位置有可测的中间值；内容本身不参与任何断言。`,
            },
          ],
        ],
        seconds: '10s',
      },
);

export const chiefScrollLong: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '滚动保留探针…',
    stream: CHIEF_SCROLL_ROWS,
  },
};

const CHIEF_MD_REPLY = [
  '## 凭证链路验证报告',
  '',
  '三项检查已完成，**全部通过**，输出细节在 `docs/verify/` 目录。',
  '',
  '- **项目**: 凭证链路验证',
  '- 次要点: 复核在任务里进行',
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
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '验证一下凭证链路…',
    running: true,
    stream: [
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

const CHIEF_MD_REF_REPLY = [
  '这是一段测试用的 Markdown：',
  '',
  '# 一级标题',
  '',
  '## 二级标题',
  '',
  '**粗体**、*斜体*、~~删除线~~、`行内代码`',
  '',
  '| 名称 | 数量 | 状态 |',
  '| --- | ---: | --- |',
  '| 苹果 | 3 | 有货 |',
  '| 香蕉 | 12 | 缺货 |',
  '',
  '- 无序列表一',
  '- 无序列表二',
  '  - 嵌套项',
  '',
  '1. 有序列表一',
  '2. 有序列表二',
  '',
  '> 这是一段引用',
  '',
  '[链接示例](https://example.com)',
  '',
  '```python',
  'from collections import Counter',
  '',
  'counts = Counter(text.split())',
  '```',
  '',
  '- [ ] 未完成',
  '- [x] 已完成',
].join('\n');

export const chiefMarkdownRef: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(14, 52),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '输出表格和其他 Markdown…',
    stream: [
      {
        kind: 'user',
        id: 'md-ref-ask',
        text: '给我展示你的所有功能',
        createdAt: r7(14, 50),
      },
      {
        kind: 'robot',
        id: 'md-ref-intro',
        markdown:
          '我在这里帮你把事情办完，发消息给我就行。\n- 在 cairn 仓库里修 bug、写功能、开 PR\n- 调研一个问题，或为会议和决定做准备\n- 做个小页面或看板，比如 cairn 的 PR 进度\n\n连上邮箱、日历或 Linear，我还能帮你盯回复和项目进度。',
        seconds: '6s',
        createdAt: r7(14, 50) + 20_000,
      },
      {
        kind: 'user',
        id: 'md-ref-user',
        text: '输出表格，还有其他的一些markdown，我来测试',
        createdAt: r7(14, 52),
      },
      {
        kind: 'robot',
        id: 'md-ref-reply',
        markdown: CHIEF_MD_REF_REPLY,
        seconds: '9s',
        createdAt: r7(14, 52) + 30_000,
      },
    ],
  },
};

const CHIEF_WIDE_TABLE_REPLY = [
  '按标题前缀分组统计如下：',
  '',
  '| 作者 | fix | feat | docs | ops | 其他（web/test/ci/daemon/ui/server/coordinator） | 合计 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  '| xiechimon | 4 | 2 | 11 | 4 | 9 | 30 |',
  '| 欧阳小明 | 2 | 0 | 3 | 3 | 7 | 15 |',
  '| `releasebot` | 1 | 0 | 0 | 5 | 1 | 7 |',
].join('\n');

export const chiefWideTable: FixtureSet = {
  todos: [],
  now: r7(14, 52),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '按作者统计提交',
    stream: [
      { kind: 'user', id: 'wide-table-ask', text: '按作者统计最近的提交', createdAt: r7(14, 51) },
      {
        kind: 'robot',
        id: 'wide-table-reply',
        markdown: CHIEF_WIDE_TABLE_REPLY,
        seconds: '9s',
        createdAt: r7(14, 52),
      },
    ],
  },
};

const CHIEF_PROSE_TABLE_REPLY = [
  '三个任务的现状：',
  '',
  '| 任务 | 状态 | 执行机 | 说明 |',
  '| --- | --- | --- | --- |',
  '| 重试预算 | 进行中 | mini | 压测显示跨区链路超时最多，正在把预算放宽后重新跑一轮对照 |',
  '| 发送修复 | 已完成 | mini | 停掉的任务重发排队消息会接着执行，归档任务给出中文原因 |',
].join('\n');

const CHIEF_PATH_TABLE_REPLY = [
  '相关位置：',
  '',
  '| 项目 | 位置 |',
  '| --- | --- |',
  '| 命令 | `pnpm  --filter web exec playwright test` |',
  '| 路径 | `apps/web/src/detail/components/conversation/markdown-table-renderer.tsx` |',
  '| 链接 | https://example.com/reports/2026/11/relay-retry-budget-comparison-final |',
].join('\n');

const CHIEF_MEDIUM_TABLE_REPLY = [
  '今晚的运行：',
  '',
  '| 任务 | 开始 | 执行机 | 分支 | 状态 | 模型 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| 发送修复 | 11-26 23:58:16 | macmini-runner | fix/reply-table | passed on retry | claude-sonnet-5 |',
].join('\n');

const CHIEF_BUILD_TABLE_REPLY = [
  '最近一次构建：',
  '',
  '| Name | Time | Result |',
  '| --- | --- | --- |',
  '| nightly build | 2026-11-26 23:58 | passed |',
].join('\n');

export const chiefMediumTable: FixtureSet = {
  todos: [],
  now: r7(14, 52),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '今晚的运行',
    stream: [
      { kind: 'user', id: 'medium-table-ask', text: '今晚跑得怎样', createdAt: r7(14, 50) },
      {
        kind: 'robot',
        id: 'medium-table-reply',
        markdown: CHIEF_MEDIUM_TABLE_REPLY,
        seconds: '9s',
        createdAt: r7(14, 51),
      },
      {
        kind: 'robot',
        id: 'build-table-reply',
        markdown: CHIEF_BUILD_TABLE_REPLY,
        seconds: '4s',
        createdAt: r7(14, 52),
      },
    ],
  },
};

export const chiefProseTable: FixtureSet = {
  todos: [],
  now: r7(14, 52),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '任务现状',
    stream: [
      { kind: 'user', id: 'prose-table-ask', text: '三个任务现在怎样了', createdAt: r7(14, 50) },
      {
        kind: 'robot',
        id: 'prose-table-reply',
        markdown: CHIEF_PROSE_TABLE_REPLY,
        seconds: '9s',
        createdAt: r7(14, 51),
      },
      {
        kind: 'robot',
        id: 'path-table-reply',
        markdown: CHIEF_PATH_TABLE_REPLY,
        seconds: '4s',
        createdAt: r7(14, 52),
      },
    ],
  },
};

const CHIEF_CJK_MID_WIDE_REPLY = [
  '多列运行状态：',
  '',
  '| 任务 | 状态 | 执行机 | 分支 | 模型 | 开始时间 | 说明 | 下一步 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 重试预算 | 进行中 | macmini-runner | fix/reply-table | claude-sonnet-5 | 11-26 23:58:16 | 压测显示跨区链路超时最多，正在重跑对照 | 等对照跑完再决定是否放宽预算 |',
].join('\n');

const CHIEF_MANY_PROSE_CJK_REPLY = [
  '调整前后对比：',
  '',
  '| 改动之前 | 改动之后 | 用户看到什么 | 决定 |',
  '| --- | --- | --- | --- |',
  '| 第一列被挤成三行，名字从中间断开，很难读清楚内容 | 短词保持完整，超出的部分在气泡里左右滑动查看即可 | 一眼就能读完整行，不需要在脑子里拼接被拆开的名字 | 继续保持单元格自然宽度并在超出约十六字符单位后换行 |',
].join('\n');

const CHIEF_MANY_PROSE_EN_REPLY = [
  'Behavior before and after:',
  '',
  '| Before | After | User impact | Decision |',
  '| --- | --- | --- | --- |',
  '| wraps to three lines now when placed beside wider prose columns | stays on a single clean line inside short cells | every short status phrase reads intact without hyphenation or jagged breaks | cap column wrap at sixteen rem and scroll wider tables inside the bubble |',
].join('\n');

export const chiefTableMatrix: FixtureSet = {
  todos: [],
  now: r7(14, 55),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '表格渲染检查',
    stream: [
      {
        kind: 'user',
        id: 'matrix-table-ask',
        text: '看一下多列与长文本表格',
        createdAt: r7(14, 50),
      },
      {
        kind: 'robot',
        id: 'cjk-mid-wide-reply',
        markdown: CHIEF_CJK_MID_WIDE_REPLY,
        seconds: '6s',
        createdAt: r7(14, 51),
      },
      {
        kind: 'robot',
        id: 'many-prose-cjk-reply',
        markdown: CHIEF_MANY_PROSE_CJK_REPLY,
        seconds: '5s',
        createdAt: r7(14, 52),
      },
      {
        kind: 'robot',
        id: 'many-prose-en-reply',
        markdown: CHIEF_MANY_PROSE_EN_REPLY,
        seconds: '4s',
        createdAt: r7(14, 53),
      },
    ],
  },
};

const CHIEF_VOICE_REPLY = [
  '压测结果整理好了，重试预算是主要瓶颈：',
  '',
  '- 预算从 3 秒放宽到 8 秒后，超时率降到 0.4%',
  '- 失败集中在跨区链路，同区几乎没有',
  '- 重试次数不用改，**预算**才是关键',
  '',
  '| 预算 | 请求数 | 超时率 |',
  '| --- | ---: | ---: |',
  '| 3 秒 | 12,480 | 6.1% |',
  '| 8 秒 | 12,512 | 0.4% |',
  '',
  '配置改成这样：',
  '',
  '```yaml',
  'relay:',
  '  retry:',
  '    attempts: 3',
  '    budget: 8s',
  '```',
  '',
  '改动已经交给任务处理，合并前我会再核对一遍。',
].join('\n');

export const chiefVoice: FixtureSet = {
  todos: [legacyReview, legacyDone, contributingGuide],
  now: r7(15, 12),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '看下 relay 重试为什么老超时',
    stream: [
      {
        kind: 'user',
        id: 'voice-ask',
        text: '看下 relay 重试为什么老超时',
        createdAt: r7(15, 0),
      },
      {
        kind: 'robot',
        id: 'voice-short',
        markdown: '查到了：重试预算只有 3 秒，跨区链路一抖就超时。我先跑一轮压测确认。',
        seconds: '12s',
        createdAt: r7(15, 0) + 20_000,
      },
      {
        kind: 'task-card',
        id: 'voice-task-card',
        todoId: contributingGuide.id,
        projectId: contributingGuide.projectId,
        seq: contributingGuide.seqNum,
        title: contributingGuide.title,
      },
      { kind: 'handoff', id: 'voice-handoff', todoId: legacyReview.id },
      {
        kind: 'user',
        id: 'voice-data',
        text: '把压测数据和改法整理一下',
        createdAt: r7(15, 5),
      },
      {
        kind: 'robot',
        id: 'voice-long',
        markdown: CHIEF_VOICE_REPLY,
        seconds: '31s',
        createdAt: r7(15, 5) + 40_000,
      },
      {
        kind: 'user',
        id: 'voice-again',
        text: '再跑一遍跨区压测',
        createdAt: r7(15, 9),
      },
      {
        kind: 'error',
        id: 'voice-failed',
        text: '模型服务暂时不可用，这一轮没有完成。',
        createdAt: r7(15, 9) + 10_000,
      },
      {
        kind: 'user',
        id: 'voice-later',
        text: '好，服务恢复后再跑',
        createdAt: r7(15, 10),
      },
      {
        kind: 'robot',
        id: 'voice-ack',
        markdown: '好的，服务恢复后我再跑跨区压测，结果出来告诉你。',
        seconds: '4s',
        createdAt: r7(15, 10) + 8_000,
      },
    ],
  },
};

const CHIEF_CODE_REPLY = [
  '读取记录的函数如下：',
  '',
  '```python',
  'from pathlib import Path',
  '',
  'def load_records(path: Path) -> list[dict]:',
  '    """Load JSON records from a file."""',
  '    # utf-8 only',
  '    with path.open("r", encoding="utf-8") as f:',
  '        return json.load(f)[:10] or None',
  '```',
].join('\n');

const CHIEF_SHELL_REPLY = [
  '4）用 shell 运行 echo ok && uname -a：结果正常',
  '',
  '```',
  'ok',
  'Linux cairn-computer-bb6faa85aec8598156e6319e 6.18.56 #1 SMP Fri Oct 16 18:41:09 UTC 2026 aarch64 GNU/Linux',
  '```',
  '',
  '电脑能正常执行命令，可以继续派任务。',
].join('\n');

export const chiefCode: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '读取记录的函数…',
    stream: [
      { kind: 'user', id: 'code-ask', text: '写一个读取 JSON 记录的函数', createdAt: r7(13, 10) },
      {
        kind: 'robot',
        id: 'code-reply',
        markdown: CHIEF_CODE_REPLY,
        seconds: '12s',
        createdAt: r7(13, 10) + 12_000,
      },
      {
        kind: 'user',
        id: 'shell-ask',
        text: '在电脑上跑一下 echo ok && uname -a',
        createdAt: r7(13, 13),
      },
      {
        kind: 'robot',
        id: 'shell-reply',
        markdown: CHIEF_SHELL_REPLY,
        seconds: '8s',
        createdAt: r7(13, 13) + 8_000,
      },
    ],
  },
};

const CHIEF_MERMAID_FLOW = [
  '登录流程如下：',
  '',
  '```mermaid',
  'flowchart LR',
  '  open[打开 Cairn] --> signed{已登录？}',
  '  signed -- 是 --> home[进入首页]',
  '  signed -- 否 --> login[用 GitHub 登录]',
  '  login --> home',
  '```',
].join('\n');

const CHIEF_MERMAID_SEQUENCE = [
  '派任务时各方的交互：',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  participant 你',
  '  participant Coordinator',
  '  participant 电脑',
  '  你->>Coordinator: 修好登录页的报错',
  '  Coordinator->>电脑: 派出任务',
  '  电脑-->>Coordinator: 提交 PR',
  '  Coordinator-->>你: 请你验收',
  '```',
].join('\n');

const CHIEF_MERMAID_STATE = [
  '任务的状态：',
  '',
  '```mermaid',
  'stateDiagram-v2',
  '  [*] --> 排队',
  '  排队 --> 进行中',
  '  进行中 --> 待验收',
  '  待验收 --> 完成',
  '  待验收 --> 进行中: 退回修改',
  '  完成 --> [*]',
  '```',
].join('\n');

const CHIEF_MERMAID_LONG = [
  '标签很长时：',
  '',
  '```mermaid',
  'flowchart TD',
  '  a[从仓库根目录读取配置文件并校验每一个字段的取值范围] --> b[把校验通过的配置写入本地缓存，供下一次启动直接使用]',
  '  b --> c[启动后台同步，定期把远端的最新改动合并到本地工作区]',
  '```',
].join('\n');

const CHIEF_MERMAID_BROKEN = [
  '这张图写错了：',
  '',
  '```mermaid',
  'flowchart LR',
  '  a[开始 --> b',
  '```',
].join('\n');

const CHIEF_MERMAID_GANTT = [
  '排期：',
  '',
  '```mermaid',
  'gantt',
  '  title 发布排期',
  '  section 开发',
  '  写代码 :a1, 2026-11-01, 5d',
  '```',
].join('\n');

const mermaidReply = (id: string, markdown: string, minute: number) => ({
  kind: 'robot' as const,
  id,
  markdown,
  seconds: '6s',
  createdAt: r7(13, minute) + 6_000,
});

export const chiefMermaid: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '画几张流程图…',
    stream: [
      { kind: 'user', id: 'mermaid-ask', text: '画几张图给我看看', createdAt: r7(13, 1) },
      mermaidReply('mermaid-flow', CHIEF_MERMAID_FLOW, 1),
      mermaidReply('mermaid-sequence', CHIEF_MERMAID_SEQUENCE, 2),
      mermaidReply('mermaid-state', CHIEF_MERMAID_STATE, 3),
      mermaidReply('mermaid-long', CHIEF_MERMAID_LONG, 4),
      mermaidReply('mermaid-broken', CHIEF_MERMAID_BROKEN, 5),
      mermaidReply('mermaid-gantt', CHIEF_MERMAID_GANTT, 6),
    ],
  },
};

export const chiefQuestion: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给贪吃蛇小游戏定难度…',
    stream: [
      { kind: 'user', text: '给贪吃蛇小游戏定一下难度曲线，拆好任务再开工。' },
      {
        kind: 'question',
        id: 'q-answered',
        requestId: 'q-answered',
        status: 'answered',
        questions: [
          {
            header: '目标平台',
            question: '先做哪一端？',
            options: [{ label: '桌面浏览器' }, { label: '手机浏览器' }],
          },
        ],
        answers: [{ header: '目标平台', choices: ['桌面浏览器'] }],
      },
      {
        kind: 'question',
        id: 'q-answered-group',
        requestId: 'q-answered-group',
        status: 'answered',
        questions: [
          {
            header: '棋盘',
            question: '棋盘做多大？',
            options: [{ label: '20 × 20' }, { label: '30 × 30' }],
          },
          {
            header: '撞墙',
            question: '撞到墙算结束，还是从另一边穿出来？',
            options: [{ label: '撞墙就结束' }, { label: '从另一边穿出来' }],
          },
        ],
        answers: [
          { header: '棋盘', choices: ['20 × 20'] },
          { header: '撞墙', choices: ['撞墙就结束'] },
        ],
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '好，先做桌面端。难度还需要你定两件事：' }]],
        seconds: '12s',
      },
      {
        kind: 'question',
        id: 'q-pending',
        requestId: 'q-pending',
        status: 'pending',
        questions: [
          {
            header: '难度曲线',
            question: '蛇速随分数怎么涨？',
            options: [
              { label: '每 50 分加速一档' },
              { label: '每吃 5 个果子加速一档' },
              { label: '保持匀速，只加障碍' },
            ],
          },
          { header: '上限', question: '最高速度给多少格每秒？', options: [] },
        ],
        answers: null,
      },
    ],
  },
};

export const chiefDefault: ChiefContent = {
  bound: false,
  threadTitle: '新主题',
};

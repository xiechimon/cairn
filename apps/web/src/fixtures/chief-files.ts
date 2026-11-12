import { legacyDone, legacyReview, r7 } from './core.js';
import type { ChiefContent, ChiefStreamItem, ComposerFileSeed, FixtureSet } from './records.js';

const TEAM = 'team-files';

const OFFICE_FILE = '第一阶段交付-功能清单进度-261029-汇总.xlsx';

const INTRO: ChiefStreamItem[] = [
  {
    kind: 'robot',
    id: 'files-intro',
    markdown:
      '我在这里帮你把事情办完，发消息给我就行。\n\n- 在 cairn 仓库里修 bug、写功能、开 PR\n- 调研一个问题，或为会议和决定做准备\n- 做个小页面或看板，比如 cairn 的 PR 进度',
    seconds: '',
  },
  {
    kind: 'robot',
    id: 'files-intro-2',
    markdown: '连上邮箱和日历，我还能帮你盯回复和项目进度。',
    seconds: '',
  },
  { kind: 'user', id: 'files-connect', text: '先连邮箱' },
  { kind: 'user', id: 'files-stop', text: '算了，先不连' },
  { kind: 'robot', id: 'files-ack', markdown: '好，不连了。', seconds: '' },
];

const LOG_LINES = [
  '2026-11-10 21:04:12 INFO  daemon: machine relay-186 connected (claude-code 2.4.1)',
  '2026-11-10 21:04:13 INFO  claim: step build-3877/verify claimed by relay-186',
  '2026-11-10 21:04:19 WARN  runner: pnpm install took 41.2s, above the 30s budget; the shared heavy slot was busy with build-3871',
  '2026-11-10 21:05:02 INFO  vitest: 1184 passed, 0 failed (apps/web)',
  '2026-11-10 21:05:47 ERROR playwright: e2e/attachment-strip.spec.ts:455 expected 112, received 122',
  '2026-11-10 21:05:47 INFO  runner: step finished with exit code 1',
];

const LONG_LOG = Array.from({ length: 240 }, (_, i) => LOG_LINES[i % LOG_LINES.length] ?? '').join(
  '\n',
);

const IMAGE_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="#f4f1ea"/><rect x="0" y="0" width="220" height="600" fill="#e8e3d8"/><rect x="24" y="32" width="120" height="14" rx="7" fill="#b9b1a1"/><rect x="24" y="80" width="172" height="28" rx="6" fill="#d6cfc0"/><rect x="24" y="124" width="140" height="12" rx="6" fill="#c9c1b1"/><rect x="24" y="152" width="156" height="12" rx="6" fill="#c9c1b1"/><rect x="300" y="420" width="580" height="96" rx="16" fill="#ffffff" stroke="#d6cfc0"/><rect x="560" y="80" width="320" height="44" rx="22" fill="#e9c9a8"/><rect x="300" y="160" width="360" height="88" rx="18" fill="#ffffff" stroke="#e1dbcf"/><rect x="324" y="186" width="250" height="12" rx="6" fill="#b9b1a1"/><rect x="324" y="212" width="190" height="12" rx="6" fill="#c9c1b1"/></svg>',
)}`;

function filesChief(stream: ChiefStreamItem[], composerFiles?: ComposerFileSeed[]): ChiefContent {
  return {
    view: 'none',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: 'Coordinator',
    threadId: 'chief-files',
    stream: [...INTRO, ...stream],
    ...(composerFiles !== undefined ? { composerFiles } : {}),
  };
}

function filesScenario(
  stream: ChiefStreamItem[],
  attachments: FixtureSet['attachments'] = {},
  composerFiles?: ComposerFileSeed[],
): FixtureSet {
  return {
    todos: [legacyReview, legacyDone],
    now: r7(14, 52),
    attachments,
    chief: filesChief(stream, composerFiles),
  };
}

const EMPTY_TEXT_TURN: ChiefStreamItem[] = [
  {
    kind: 'user',
    id: 'files-send',
    text: `![test.txt](attachment:${TEAM}/att-test-txt.txt)\n查看内容`,
    markdown: `![test.txt](attachment:${TEAM}/att-test-txt.txt)\n查看内容`,
  },
  {
    kind: 'robot',
    id: 'files-answer',
    markdown: 'test.txt 是空的，里面没有任何内容。',
    seconds: '',
  },
];

export const CHIEF_FILES_SCENARIOS: Record<string, FixtureSet> = {
  'chief-files': filesScenario(EMPTY_TEXT_TURN, { 'att-test-txt': { text: '' } }),
  'chief-files-image': filesScenario(
    [
      {
        kind: 'user',
        id: 'files-image',
        text: `![首页设计稿.png](attachment:${TEAM}/att-home-shot.png)\n按这张图改首页的对话区`,
        markdown: `![首页设计稿.png](attachment:${TEAM}/att-home-shot.png)\n按这张图改首页的对话区`,
      },
      {
        kind: 'robot',
        id: 'files-image-answer',
        markdown: '看到了：左侧栏收窄、输入框放到底部居中。我先建个任务改对话区。',
        seconds: '',
      },
    ],
    { 'att-home-shot': { src: IMAGE_SRC } },
  ),
  'chief-files-long': filesScenario(
    [
      {
        kind: 'user',
        id: 'files-log',
        text: `![verify-3877.log](attachment:${TEAM}/att-verify-log.log)\n这次验证为什么失败？`,
        markdown: `![verify-3877.log](attachment:${TEAM}/att-verify-log.log)\n这次验证为什么失败？`,
      },
      {
        kind: 'robot',
        id: 'files-log-answer',
        markdown:
          '失败在 attachment-strip.spec.ts 第 455 行：用例还按 112px 量附件块，现在是 122px。改测试里的尺寸就能过。',
        seconds: '',
      },
    ],
    { 'att-verify-log': { text: LONG_LOG } },
  ),
  'chief-files-unsupported': filesScenario(
    [
      {
        kind: 'user',
        id: 'files-office',
        text: `![${OFFICE_FILE}](attachment:${TEAM}/att-office.xlsx)\n汇总一下进度`,
        markdown: `![${OFFICE_FILE}](attachment:${TEAM}/att-office.xlsx)\n汇总一下进度`,
      },
      {
        kind: 'robot',
        id: 'files-office-answer',
        markdown: '这个表格我读不了内容，导出成 CSV 再发我就行。',
        seconds: '',
      },
    ],
    {},
  ),
  'chief-files-composer': filesScenario([], {}, [{ name: OFFICE_FILE, state: 'ready' }]),
  'chief-files-uploading': filesScenario([], {}, [{ name: OFFICE_FILE, state: 'uploading' }]),
  'chief-files-failed': filesScenario([], {}, [{ name: 'test.txt', state: 'error' }]),
};

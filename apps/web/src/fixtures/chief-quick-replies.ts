import { legacyDone, legacyReview, r7 } from './core.js';
import type { FixtureSet } from './records.js';

export const chiefQuickReplies: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(11, 22),
  chief: {
    view: 'none',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '看一遍 cairn 仓库',
    stream: [
      { kind: 'user', text: '帮我看一遍这个仓库，建一个测试任务' },
      {
        kind: 'robot',
        markdown:
          '已把 xiechimon/cairn 加进来，测试任务「查看 cairn 仓库（测试）」也建好了，正在读仓库。\n\n读完后我会汇报技术栈和最近的提交，你确认后再标记完成。要不要先只看 README？',
        seconds: '',
      },
    ],
    quickReplies: ['好，等你汇报', '先只看 README'],
  },
};

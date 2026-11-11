import { legacyDone, legacyReview, r7 } from './core.js';
import type { FixtureSet } from './records.js';

export const chiefBubbleRuns: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(15, 10),
  chief: {
    view: 'none',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '连邮箱',
    stream: [
      { kind: 'user', id: 'run-u1', text: '帮我把今天的邮件理一遍', createdAt: r7(9, 2) },
      {
        kind: 'robot',
        id: 'run-r1',
        markdown: '要先连上邮箱才能读邮件。',
        seconds: '',
        createdAt: r7(9, 2),
      },
      {
        kind: 'robot',
        id: 'run-r2',
        markdown: '连好以后我会按发件人和紧急程度分组，再给你一份摘要。',
        seconds: '',
        createdAt: r7(9, 3),
      },
      { kind: 'user', id: 'run-u2', text: '先连邮箱', createdAt: r7(9, 4) },
      { kind: 'user', id: 'run-u3', text: '算了，先不连', createdAt: r7(9, 4) },
      { kind: 'user', id: 'run-u4', text: '下午再说', createdAt: r7(9, 5) },
      {
        kind: 'robot',
        id: 'run-r3',
        markdown: '好，下午提醒你。',
        seconds: '',
        createdAt: r7(9, 5),
      },
      { kind: 'user', id: 'run-u5', text: '现在可以连了', createdAt: r7(14, 40) },
      { kind: 'user', id: 'run-u6', text: '用工作邮箱', createdAt: r7(14, 41) },
    ],
  },
};

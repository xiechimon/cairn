import { PROBE_ID, probeTodo, r7 } from './core.js';
import type { FixtureSet, TranscriptItem, WorkStep } from './records.js';

const MINUTE = 60_000;
const START = r7(13, 0);

function call(id: string, command: string): WorkStep {
  return {
    kind: 'call',
    id,
    action: 'run',
    label: 'bash',
    command,
    seconds: 4,
    output: null,
    error: false,
    running: false,
    unfinished: false,
  };
}

const TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:00' },
  {
    kind: 'user',
    id: 'turn-fold-u1',
    text: 'Fix the flaky login test\nIt fails on CI about one run in five.',
    createdAt: START,
  },
  {
    kind: 'work',
    id: 'turn-fold-w1',
    steps: [call('turn-fold-c1', 'pnpm exec playwright test login --repeat-each=20')],
    createdAt: START + 3 * MINUTE,
  },
  {
    kind: 'robot',
    id: 'turn-fold-r1',
    paragraphs: [[{ text: 'The test now waits for the inbox URL before reading the cookie.' }]],
    createdAt: START + 4 * MINUTE,
  },
  {
    kind: 'user',
    id: 'turn-fold-u2',
    text: 'Bump Playwright to the latest release.',
    createdAt: START + 5 * MINUTE,
  },
  {
    kind: 'work',
    id: 'turn-fold-w2',
    steps: [call('turn-fold-c2', 'pnpm up @playwright/test')],
    createdAt: START + 7 * MINUTE,
  },
  { kind: 'fail', title: 'The run stopped', body: '运行失败，请查看原始错误排查原因后重试。' },
  {
    kind: 'user',
    id: 'turn-fold-u3',
    text: 'Add a regression test for the redirect race.',
    createdAt: START + 8 * MINUTE,
  },
  { kind: 'streaming', seconds: 3, label: '处理中...' },
];

export const turnFoldThread: FixtureSet = {
  todos: [probeTodo('building', r7(13, 8))],
  now: r7(13, 9),
  detail: { transcript: TRANSCRIPT },
};

export const TURN_FOLD_THREAD_URL = `/app/todo/${PROBE_ID}?scenario=turn-fold-thread`;

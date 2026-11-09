import {
  type BuildRecord,
  SESSION_REWORK_BRIEF,
  type StepJournalRow,
  type StepPromptOrigin,
  transcriptPromptRowId,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapTranscript } from '../src/api/mappers.js';
import type { TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const BUILD: BuildRecord = {
  id: 'build-1',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

const PREPUSH_LOG = Array.from(
  { length: 900 },
  (_, i) => `[prepush] node scripts/gate-${i}.mjs\ngate-${i}: PASS`,
).join('\n');

const CI_FIX_PROMPT = `[ci-fix] Local pre-push hook rejected the closing push (round 1/3).\n\n${PREPUSH_LOG}\n\nFix the hook failures and push the same branch cairn/conv-build-1.`;

function step(id: string, at: number, promptOrigin?: StepPromptOrigin): StepJournalRow {
  return {
    id,
    buildId: BUILD.id,
    kind: 'session',
    machineId: null,
    createdAt: at,
    status: 'done',
    checkpointCommit: null,
    skillInjection: null,
    ...(promptOrigin !== undefined ? { promptOrigin } : {}),
  };
}

function promptRow(stepId: string, content: string, at: number): MessageRow {
  return { id: transcriptPromptRowId(stepId), role: 'user', content, createdAt: at };
}

function render(messages: MessageRow[], steps: StepJournalRow[]): TranscriptItem[] {
  return mapTranscript({
    messages,
    steps,
    plans: [],
    build: BUILD,
    todo: { ...todo(1, 'building'), title: '公开内容闸门', spec: '拦住非英文的公开内容。' },
    machineName: null,
    userName: 'ian',
    liveText: '',
  });
}

function kindsOf(items: TranscriptItem[], kind: TranscriptItem['kind']) {
  return items.filter((item) => item.kind === kind);
}

describe('system-authored step prompts', () => {
  test('a ci-fix prompt with its hook log becomes one step-prompt row, not a user bubble', () => {
    const origin: StepPromptOrigin = {
      kind: 'ci-fix',
      trigger: 'pre-push',
      round: 1,
      roundsMax: 3,
    };
    const items = render(
      [promptRow('fix-1', CI_FIX_PROMPT, NOW)],
      [step('fix-1', NOW - 1_000, origin)],
    );
    expect(kindsOf(items, 'user')).toEqual([]);
    expect(kindsOf(items, 'step-prompt')).toEqual([
      { kind: 'step-prompt', id: transcriptPromptRowId('fix-1'), origin, raw: CI_FIX_PROMPT },
    ]);
  });

  test('a rework prompt folds while the owner feedback it wraps stays a bubble', () => {
    const feedback = '哪个分支';
    const rework = `${SESSION_REWORK_BRIEF}\n\n${feedback}\n[cairn 系统规则，不是用户的消息]工作分支注记：本步的工作分支是 cairn/conv-build-1。`;
    const items = render(
      [
        { id: 'owner-1', role: 'user', content: feedback, createdAt: NOW - 500 },
        promptRow('rework-1', rework, NOW),
      ],
      [step('rework-1', NOW - 1_000, { kind: 'rework' })],
    );
    expect(kindsOf(items, 'user').map((item) => item.kind === 'user' && item.text)).toEqual([
      feedback,
    ]);
    expect(kindsOf(items, 'step-prompt')).toEqual([
      {
        kind: 'step-prompt',
        id: transcriptPromptRowId('rework-1'),
        origin: { kind: 'rework' },
        raw: rework,
      },
    ]);
  });

  test('an owner message that quotes a ci-fix prompt keeps the normal bubble', () => {
    const typed = '[ci-fix] Local pre-push hook rejected the closing push (round 1/3). 这是什么意思？';
    const items = render(
      [{ id: 'owner-2', role: 'user', content: typed, createdAt: NOW }],
      [step('fix-1', NOW - 1_000, { kind: 'ci-fix', trigger: 'pre-push', round: 1, roundsMax: 3 })],
    );
    expect(kindsOf(items, 'step-prompt')).toEqual([]);
    expect(kindsOf(items, 'user').map((item) => item.kind === 'user' && item.text)).toEqual([typed]);
  });
});

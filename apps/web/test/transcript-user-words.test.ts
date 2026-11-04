import {
  type BuildRecord,
  CONFIRM_ANNOUNCEMENT,
  CONTINUE_PROMPTS,
  DONE_ANNOUNCEMENT,
  REVIEW_ANNOUNCEMENT,
  type StepJournalRow,
  buildPlanFirstRoundInstruction,
  buildPlanRewritePrompt,
  buildReplanPrompt,
  buildRestartPrompt,
  buildReworkNewBranchNote,
  buildReworkReuseNote,
  buildTaskPromptText,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapTranscript } from '../src/api/mappers.js';
import type { TodoRecord, TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const TITLE = '登录按钮圆角与悬停过渡';
const SPEC = '# 任务目标\n\n把圆角改成 **8px**，并且：\n\n- 悬停态加过渡\n\n```css\n.login-btn { border-radius: 8px; }\n```';

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

let msgSeq = 0;
function msg(
  role: MessageRow['role'],
  content: unknown,
  at: number,
  actor?: string | null,
): MessageRow {
  msgSeq += 1;
  return {
    id: `msg-${msgSeq}`,
    role,
    content,
    createdAt: at,
    ...(actor === undefined ? {} : { actor }),
  };
}

function render(overrides: {
  messages: MessageRow[];
  todo?: TodoRecord;
  steps?: StepJournalRow[];
  build?: BuildRecord | null;
}): TranscriptItem[] {
  const base = todo(1, 'building');
  return mapTranscript({
    messages: overrides.messages,
    steps: overrides.steps ?? [],
    plans: [],
    build: overrides.build === undefined ? BUILD : overrides.build,
    todo: overrides.todo ?? { ...base, title: TITLE, spec: SPEC },
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
  });
}

function userItems(items: TranscriptItem[]) {
  return items.filter((i): i is Extract<TranscriptItem, { kind: 'user' }> => i.kind === 'user');
}

function noteItems(items: TranscriptItem[]) {
  return items.filter((i): i is Extract<TranscriptItem, { kind: 'note' }> => i.kind === 'note');
}

describe('mapTranscript synthesized-prompt filtering (#612)', () => {
  test('F1 synthesized task text rows no longer render as user bubbles (the description area is the single source)', () => {
    const items = render({
      messages: [
        msg('user', buildTaskPromptText(TITLE, SPEC), NOW - 50_000),
        msg('assistant', [{ type: 'text', text: '收到，开始规划。' }], NOW - 40_000),
      ],
    });
    expect(userItems(items)).toHaveLength(0);

    expect(items.some((i) => i.kind === 'robot')).toBe(true);
  });

  test('F2 filtered task text rows do not leak firstUser to later real user rows', () => {
    const items = render({
      messages: [
        msg('user', buildTaskPromptText(TITLE, SPEC), NOW - 50_000),
        msg('user', '另外注意移动端', NOW - 30_000),
      ],
    });
    const users = userItems(items);
    expect(users).toHaveLength(1);

    expect(users[0]?.seq).toBeUndefined();
    expect(users[0]?.title).toBeUndefined();
  });

  test('F3 all three CONTINUE_PROMPTS sentences filtered', () => {
    const items = render({
      messages: [
        msg('user', CONTINUE_PROMPTS.plan, NOW - 50_000),
        msg('user', CONTINUE_PROMPTS.build, NOW - 40_000),
        msg('user', CONTINUE_PROMPTS.merge, NOW - 30_000),
      ],
    });
    expect(userItems(items)).toHaveLength(0);
  });

  test('F4 replan/restart template rows filtered (arbitrary feedback embedded)', () => {
    const items = render({
      messages: [
        msg('user', '标题太长了', NOW - 60_000),
        msg('user', buildReplanPrompt('标题太长了'), NOW - 50_000),
        msg('user', buildRestartPrompt('先跑 lint 再提交'), NOW - 40_000),
      ],
    });
    const users = userItems(items);

    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('标题太长了');
  });

  test('F12 the #703 backfill-round instruction row (plan.md backfill template) filtered — continuation instructions do not pose as user words', () => {

    const items = render({
      messages: [msg('user', buildPlanRewritePrompt(), NOW - 50_000)],
    });
    expect(userItems(items)).toHaveLength(0);
  });

  test('F5 review-step material rows (first-line JSON meta) filtered', () => {
    const reviewMaterial = [
      JSON.stringify({ kind: 'review', agentId: 'agent-1', gate: 'confirm' }),
      '请审核以下方案。**只审核、不修改 worktree、不动 plan.md**',
      '',
      '## 待审核方案',
      '# plan.md 全文……',
    ].join('\n');
    const items = render({ messages: [msg('user', reviewMaterial, NOW - 50_000)] });
    expect(userItems(items)).toHaveLength(0);
  });

  test('F6 REVIEW_ANNOUNCEMENT renders as a note row (merge-announcement family), not a bubble', () => {
    const items = render({ messages: [msg('user', REVIEW_ANNOUNCEMENT, NOW - 50_000)] });
    expect(userItems(items)).toHaveLength(0);
    expect(noteItems(items).map((n) => n.text)).toContain(`Xmon Dai ${REVIEW_ANNOUNCEMENT}`);
  });

  test('F7 MERGE_ANNOUNCEMENT note row behavior unchanged (regression pin)', () => {
    const items = render({ messages: [msg('user', '发起了合并', NOW - 50_000)] });
    expect(userItems(items)).toHaveLength(0);
    expect(noteItems(items).map((n) => n.text)).toContain('Xmon Dai 发起了合并');
  });

  test('F8 real user utterances carry the markdown slot (the render layer walks chat-markdown)', () => {
    const steer = '按这个改：\n\n```css\n.login-btn { border-radius: 10px; }\n```';
    const items = render({ messages: [msg('user', steer, NOW - 50_000)] });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.markdown).toBe(steer);
    expect(users[0]?.text).toBe(steer);
  });

  test("F9 mapper-produced '确认' rows keep the plain-text slot (fixture family DOM does not drift)", () => {
    const buildStep: StepJournalRow = {
      id: 'step-build-done',
      buildId: BUILD.id,
      kind: 'build',
      machineId: null,
      createdAt: NOW - 20_000,
      status: 'done',
      checkpointCommit: null,
      skillInjection: null,
    };
    const items = render({
      messages: [msg('user', buildTaskPromptText(TITLE, SPEC), NOW - 50_000)],
      steps: [buildStep],
      build: { ...BUILD, withPlan: true },
    });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('确认');
    expect(users[0]?.markdown).toBeUndefined();
  });

  test('F10 the first feedback of a restart round survives, the live face hangs no taskline', () => {
    const items = render({
      messages: [
        msg('user', '先跑 lint 再提交', NOW - 50_000),
        msg('user', buildRestartPrompt('先跑 lint 再提交'), NOW - 49_000),
      ],
    });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('先跑 lint 再提交');
    expect(users[0]?.seq).toBeUndefined();
    expect(users[0]?.title).toBeUndefined();
  });

  test('F11 legacy task text rows (spec changed, no longer matching) survive as history', () => {
    const stalePrompt = buildTaskPromptText(TITLE, '# 旧版目标\n\n旧 spec');
    const items = render({ messages: [msg('user', stalePrompt, NOW - 50_000)] });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe(stalePrompt.trim());
  });

  test('F13 combo rows (task text + restart instruction) retire, real feedback rows survive', () => {
    const feedback = '先跑 lint 再提交';
    const composed = `${buildTaskPromptText(TITLE, SPEC)}\n\n${buildRestartPrompt(feedback)}`;
    const items = render({
      messages: [
        msg('user', feedback, NOW - 50_000),
        msg('user', composed, NOW - 49_000),
      ],
    });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe(feedback);
  });

  test('F13b combo rows (task text + truncated restart instruction) retire the same way (truncation does not break recognition)', () => {
    const composed = `${buildTaskPromptText(TITLE, SPEC)}\n\n${buildRestartPrompt('返'.repeat(5000))}`;
    const items = render({ messages: [msg('user', composed, NOW - 50_000)] });
    expect(userItems(items)).toHaveLength(0);
  });

  test('F13d combo rows (task title drifted) retire, real feedback rows survive', () => {
    const feedback = '先跑 lint 再提交';
    const composed = `${buildTaskPromptText('旧标题', SPEC)}\n\n${buildRestartPrompt(feedback)}`;
    const items = render({
      messages: [
        msg('user', feedback, NOW - 50_000),
        msg('user', composed, NOW - 49_000),
      ],
    });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe(feedback);
  });

  test('F13c task text followed by the user own words → not a combo row, kept as a user bubble (no false kill)', () => {
    const text = `${buildTaskPromptText(TITLE, SPEC)}\n\n另外移动端也要看一眼`;
    const items = render({ messages: [msg('user', text, NOW - 50_000)] });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe(text.trim());
  });

  test('F17 first-round plan-contract combo rows (task text + contract instruction) retire, never become user bubbles', () => {
    const composed = `${buildTaskPromptText(TITLE, SPEC)}\n\n${buildPlanFirstRoundInstruction()}`;
    const items = render({
      messages: [
        msg('user', composed, NOW - 50_000),
        msg('assistant', [{ type: 'text', text: '收到，方案落盘 plan.md。' }], NOW - 40_000),
      ],
    });
    expect(userItems(items)).toHaveLength(0);

    expect(items.some((i) => i.kind === 'robot')).toBe(true);
  });

  test('F14 the #931 rework-round-boundary note: both reuse-round and new-round system rows render as notes (do not pose as bubbles)', () => {
    const reuse = buildReworkReuseNote({
      prNumber: 888,
      prUrl: 'https://github.com/demo-owner/demo-repo/pull/888',
      failureReason: '本轮无人认领：团队当前没有在线机器',
    });
    const newBranch = buildReworkNewBranchNote({
      prNumber: 888,
      prUrl: 'https://github.com/demo-owner/demo-repo/pull/888',
      branch: 'cairn/conv-01a10c27-0000-0000-0000-000000000000',
      outcome: 'merged',
    });
    const items = render({
      messages: [
        msg('user', '我要的是svg样式的', NOW - 50_000),
        msg('system', reuse, NOW - 49_000),
        msg('system', newBranch, NOW - 48_000),
      ],
    });
    const notes = noteItems(items).map((n) => n.text);
    expect(notes).toContain(reuse);
    expect(notes).toContain(newBranch);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('我要的是svg样式的');
  });
});

describe('mapTranscript gate-announcement row actor slot (#902)', () => {
  test('F14 CONFIRM/DONE announcement rows render as note rows, not bubbles', () => {
    const items = render({
      messages: [
        msg('user', CONFIRM_ANNOUNCEMENT, NOW - 50_000, 'Xmon Dai'),
        msg('user', DONE_ANNOUNCEMENT, NOW - 40_000, 'Xmon Dai'),
      ],
    });
    expect(userItems(items)).toHaveLength(0);
    expect(noteItems(items).map((n) => n.text)).toEqual([
      `Xmon Dai ${CONFIRM_ANNOUNCEMENT}`,
      `Xmon Dai ${DONE_ANNOUNCEMENT}`,
    ]);
  });

  test('F15 the actor slot wins over the current user — a chief-passed gate is not booked under a person', () => {
    const items = render({
      messages: [msg('user', CONFIRM_ANNOUNCEMENT, NOW - 50_000, '总管甲')],
    });
    expect(noteItems(items).map((n) => n.text)).toEqual([`总管甲 ${CONFIRM_ANNOUNCEMENT}`]);
  });

  test('F16 legacy rows (actor null / absent) fall back to the current user, presentation verbatim unchanged', () => {
    const items = render({
      messages: [
        msg('user', '发起了合并', NOW - 60_000, null),
        msg('user', REVIEW_ANNOUNCEMENT, NOW - 50_000),
      ],
    });
    expect(noteItems(items).map((n) => n.text)).toEqual([
      'Xmon Dai 发起了合并',
      `Xmon Dai ${REVIEW_ANNOUNCEMENT}`,
    ]);
  });
});

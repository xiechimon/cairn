// #612 用户话语单源：transcript 里的 role-user wire 行不全是用户的话——
// daemon 把合成任务文本（title+spec）与续轮指令记进会话，server 把 replan/
// restart 模板与审核材料记进会话，呈现层此前一律渲染成用户气泡（live 实测：
// 首条 = 与描述区双渲染的「套娃」墙，其后 CONTINUE 指令、审核材料冒名顶替）。
// 失败方式先行枚举（mapper 缝；渲染缝的钉在 e2e/transcript-user-words.spec.ts）:
//   F1 合成任务文本行（== title+spec）仍渲染成 user 气泡 —— 与描述区双渲染
//   F2 任务文本行被滤后 firstUser 泄漏到下一条真实用户行（taskline 挪错行）
//   F3 CONTINUE_PROMPTS 三句渲染成用户气泡（续轮指令冒名用户话语）
//   F4 replan/restart 模板行（内嵌 feedback）渲染成用户气泡——feedback 自有
//      真行在先，模板行是纯噪声
//   F5 review 步材料（首行 JSON meta + 方案全文）渲染成巨型用户气泡
//   F6 REVIEW_ANNOUNCEMENT 渲染成用户气泡而非 note 行（与 MERGE_ANNOUNCEMENT
//      的呈现不对称——同一「宣告行」家族两种行形）
//   F7 MERGE_ANNOUNCEMENT note 行为回归（既有单源不动）
//   F8 真实 steer/驳回话语没拿到 markdown 槽（用户话语继续裸文本渲染）
//   F9 mapper 自产的 '确认' 行带上 markdown 槽（fixture 家族 DOM 形漂移）
//   F10 restart 轮首条 feedback（真实用户话）被模板过滤误杀——live 面任何
//       用户行都不再挂 taskline（任务文本行退场后它没有合法宿主；#seq+标题
//       的展示位是 dhead。fixture 捕获面的 seq/title 走 records 直供，不经
//       本 mapper）
//   F11 spec 事后被改：旧任务文本行（≠ 当前 title+spec）被误滤，历史消失
//   F13 组合行（任务文本 + 重启指令同串，#720 composeTaskPromptWithInstruction）
//       渲染成用户气泡——任务+反馈双渲染；截断形同罪；任务前缀 + 用户自己
//       话语不是组合行，不得误杀
//   F17 首轮 plan 契约组合行（任务文本 + 首轮契约指令同串，#1025
//       buildTaskPrompt 注入形）渲染成用户气泡——任务原文与描述区双渲染
//       （F1/F13 同族；契约指令进 SYNTHETIC 词表，组合行整行退场）

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
} from '@pacman/shared';
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

describe('mapTranscript 合成 prompt 过滤（#612）', () => {
  test('F1 合成任务文本行不再渲染成用户气泡（描述区单源）', () => {
    const items = render({
      messages: [
        msg('user', buildTaskPromptText(TITLE, SPEC), NOW - 50_000),
        msg('assistant', [{ type: 'text', text: '收到，开始规划。' }], NOW - 40_000),
      ],
    });
    expect(userItems(items)).toHaveLength(0);
    // agent 行不受影响
    expect(items.some((i) => i.kind === 'robot')).toBe(true);
  });

  test('F2 被滤的任务文本行不把 firstUser 泄漏给后续真实用户行', () => {
    const items = render({
      messages: [
        msg('user', buildTaskPromptText(TITLE, SPEC), NOW - 50_000),
        msg('user', '另外注意移动端', NOW - 30_000),
      ],
    });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    // taskline 装饰属于任务文本行；它退场后不转移到 steer 行
    expect(users[0]?.seq).toBeUndefined();
    expect(users[0]?.title).toBeUndefined();
  });

  test('F3 CONTINUE_PROMPTS 三句全部过滤', () => {
    const items = render({
      messages: [
        msg('user', CONTINUE_PROMPTS.plan, NOW - 50_000),
        msg('user', CONTINUE_PROMPTS.build, NOW - 40_000),
        msg('user', CONTINUE_PROMPTS.merge, NOW - 30_000),
      ],
    });
    expect(userItems(items)).toHaveLength(0);
  });

  test('F4 replan/restart 模板行过滤（任意 feedback 内嵌）', () => {
    const items = render({
      messages: [
        msg('user', '标题太长了', NOW - 60_000),
        msg('user', buildReplanPrompt('标题太长了'), NOW - 50_000),
        msg('user', buildRestartPrompt('先跑 lint 再提交'), NOW - 40_000),
      ],
    });
    const users = userItems(items);
    // 只剩 feedback 真行；两条模板行退场
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('标题太长了');
  });

  test('F12 #703 补写轮指令行（plan.md 补写模板）过滤——续轮指令冒名用户话语', () => {
    // #703 起补写/重规划轮的续轮指令真的进会话（runner 投递 claim 载荷
    // instruction），daemon 把它记成 user 行——呈现层按同族模板退场。
    const items = render({
      messages: [msg('user', buildPlanRewritePrompt(), NOW - 50_000)],
    });
    expect(userItems(items)).toHaveLength(0);
  });

  test('F5 review 步材料行（首行 JSON meta）过滤', () => {
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

  test('F6 REVIEW_ANNOUNCEMENT 渲染成 note 行（merge 宣告同族），不是气泡', () => {
    const items = render({ messages: [msg('user', REVIEW_ANNOUNCEMENT, NOW - 50_000)] });
    expect(userItems(items)).toHaveLength(0);
    expect(noteItems(items).map((n) => n.text)).toContain(`Xmon Dai ${REVIEW_ANNOUNCEMENT}`);
  });

  test('F7 MERGE_ANNOUNCEMENT note 行为不变（回归钉）', () => {
    const items = render({ messages: [msg('user', '发起了合并', NOW - 50_000)] });
    expect(userItems(items)).toHaveLength(0);
    expect(noteItems(items).map((n) => n.text)).toContain('Xmon Dai 发起了合并');
  });

  test('F8 真实用户话语携带 markdown 槽（渲染层走 chat-markdown）', () => {
    const steer = '按这个改：\n\n```css\n.login-btn { border-radius: 10px; }\n```';
    const items = render({ messages: [msg('user', steer, NOW - 50_000)] });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.markdown).toBe(steer);
    expect(users[0]?.text).toBe(steer);
  });

  test("F9 mapper 自产 '确认' 行保持纯文本槽（fixture 家族 DOM 不漂移）", () => {
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

  test('F10 restart 轮首条 feedback 保留，live 面不挂 taskline', () => {
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

  test('F11 旧任务文本行（spec 已改，不再匹配）保留为历史', () => {
    const stalePrompt = buildTaskPromptText(TITLE, '# 旧版目标\n\n旧 spec');
    const items = render({ messages: [msg('user', stalePrompt, NOW - 50_000)] });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe(stalePrompt.trim());
  });

  // —— #720 组合行族：重启轮 new session 的 wire 行 = 任务文本 + 合成指令
  // 同串投递（composeTaskPromptWithInstruction）。任务简报已有描述区、反馈已有
  // 真实用户行，组合行渲染成气泡即双渲染——整行退场。 ——
  test('F13 组合行（任务文本 + 重启指令）退场，feedback 真行保留', () => {
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

  test('F13b 组合行（任务文本 + 截断重启指令）同样退场（截断不破识别）', () => {
    const composed = `${buildTaskPromptText(TITLE, SPEC)}\n\n${buildRestartPrompt('返'.repeat(5000))}`;
    const items = render({ messages: [msg('user', composed, NOW - 50_000)] });
    expect(userItems(items)).toHaveLength(0);
  });

  test('F13c 任务文本后跟用户自己话语 → 不是组合行，保留为用户气泡（不误杀）', () => {
    const text = `${buildTaskPromptText(TITLE, SPEC)}\n\n另外移动端也要看一眼`;
    const items = render({ messages: [msg('user', text, NOW - 50_000)] });
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe(text.trim());
  });

  // —— #1025 首轮 plan 契约组合行：daemon buildTaskPrompt 对首轮 plan 步注入
  // 契约指令（任务文本 + 契约同串投递）——任务简报已有描述区，组合行渲染成
  // 气泡即任务原文双渲染（F1/F13 同族），整行退场。——
  test('F17 首轮 plan 契约组合行（任务文本 + 契约指令）退场，不成用户气泡', () => {
    const composed = `${buildTaskPromptText(TITLE, SPEC)}\n\n${buildPlanFirstRoundInstruction()}`;
    const items = render({
      messages: [
        msg('user', composed, NOW - 50_000),
        msg('assistant', [{ type: 'text', text: '收到，方案落盘 plan.md。' }], NOW - 40_000),
      ],
    });
    expect(userItems(items)).toHaveLength(0);
    // agent 行不受影响
    expect(items.some((i) => i.kind === 'robot')).toBe(true);
  });

  // —— #931 返工轮界 note（system → note 路，RESUME_FRESH_SESSION_NOTE 同族）：
  // 判定可见 = 两条 note 落进时间线成 dim note 行——「为什么这次是新 PR」
  // 用户可辨；渲染成用户气泡或被 JSON/echo 过滤误杀都算失败。——
  test('F14 #931 返工轮界 note：复用轮与新建轮的 system 行都渲染成 note（不冒名气泡）', () => {
    const reuse = buildReworkReuseNote({
      prNumber: 888,
      prUrl: 'https://github.com/demo-owner/demo-repo/pull/888',
      failureReason: '本轮无人认领：团队当前没有在线机器',
    });
    const newBranch = buildReworkNewBranchNote({
      prNumber: 888,
      prUrl: 'https://github.com/demo-owner/demo-repo/pull/888',
      branch: 'pacman/conv-01a10c27-0000-0000-0000-000000000000',
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

// #902 过闸宣告行 actor 位：行自带主体（人 / chief Agent），呈现优先 actor
// 位；存量旧行（actor 缺省/null）回落当前用户。失败方式：
//   F14 新宣告行（通过了确认 / 标记为已完成）渲染成用户气泡——不在
//       GATE_ANNOUNCEMENTS 表内，审计行冒名用户话语
//   F15 actor 位被丢——chief 过的闸显示成当前用户名（审计撒谎的呈现面）
//   F16 存量旧行（无 actor 位）呈现漂移——必须回落当前用户，逐字不变
describe('mapTranscript 过闸宣告行 actor 位（#902）', () => {
  test('F14 CONFIRM/DONE 宣告行渲染成 note 行，不是气泡', () => {
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

  test('F15 actor 位优先于当前用户——chief 过的闸不记到人名下', () => {
    const items = render({
      messages: [msg('user', CONFIRM_ANNOUNCEMENT, NOW - 50_000, '总管甲')],
    });
    expect(noteItems(items).map((n) => n.text)).toEqual([`总管甲 ${CONFIRM_ANNOUNCEMENT}`]);
  });

  test('F16 存量旧行（actor null / 缺省）回落当前用户，呈现逐字不变', () => {
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

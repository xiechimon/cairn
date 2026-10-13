// #905 活动相位的消费面（mapper 半）：活行标签接管、陈旧过滤、优先级与
// 零回归。失败方式清单（先固化；store/SSE 半在 sse-conversation-stream.test，
// 渲染半（走表/缺席不摆数）在 e2e 与 live-row 的 #471 既有律）：
//   W1 陈旧相位跨步：activity.stepId ≠ 在跑步 id → 基础标签原样，signalAt 缺席
//   W4 stopping 过渡态优先于活动标签（停止在途更要解释）
//   W5 无活动信号（fixture / 旧 server）→ 既有标签逐字不变（零回归）
//   W6 相位词表 8 件全有标签（穷尽 switch，编译期 + 运行期双保险）
//   W7 chief 面：tool 相位 → runningTool 投影；标签接管；无信号回落「处理中...」
// #918 技能事实面（活行条目 + 详情页汇总）续编：
//   W8 技能条目跨步串场：streaming 项的 skills 只来自**在跑步**的 activity
//      （W1 同一道 stepId 过滤）——陈旧步的技能条目不得挂到下一步头上。
//   W9 汇总派生自落库 toolcall 行：首见序、同名去重、denied 粘滞（挡下的
//      名字从读列移除，两列互斥）。
//   W10 对照组：无技能命中的任务不产 skills 汇总条目、streaming 项不带
//      skills 字段（空条目 = 噪声，验收明令禁止）。
//   W11 半程行（无 result 的开始半 upsert）不计入汇总——读取完成才是事实；
//      终态行同 id 覆盖后自然计入。

import type { BuildRecord, StepActivity, StepJournalRow, ToolCallRecord } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { activityLabel } from '../src/api/activity.js';
import { clockTime, mapChief, mapTranscript } from '../src/api/mappers.js';
import type { TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const BUILD: BuildRecord = {
  id: 'build-1',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  pinnedMachineId: null,
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

function step(status: StepJournalRow['status'], kind: StepJournalRow['kind'] = 'plan'): StepJournalRow {
  return {
    id: `step-${kind}-${status}`,
    buildId: BUILD.id,
    kind,
    machineId: null,
    createdAt: NOW - 30_000,
    status,
    checkpointCommit: null,
    skillInjection: null,
  };
}

function act(stepId: string, phase: StepActivity['phase'], extra?: object): StepActivity {
  return { stepId, phase, at: NOW - 2_000, ...extra } as StepActivity;
}

function render(overrides: {
  steps?: StepJournalRow[];
  stopping?: boolean;
  activity?: StepActivity | null;
  messages?: import('../src/api/mappers.js').MessageRow[];
  lastTextDeltaAt?: number | null;
  phaseHistory?: readonly StepActivity[];
}): TranscriptItem[] {
  return mapTranscript({
    messages: overrides.messages ?? [],
    steps: overrides.steps ?? [],
    plans: [],
    build: BUILD,
    todo: todo(9, 'building'),
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
    ...(overrides.stopping !== undefined ? { stopping: overrides.stopping } : {}),
    ...(overrides.activity !== undefined ? { activity: overrides.activity } : {}),
    ...(overrides.lastTextDeltaAt !== undefined ? { lastTextDeltaAt: overrides.lastTextDeltaAt } : {}),
    ...(overrides.phaseHistory !== undefined ? { phaseHistory: overrides.phaseHistory } : {}),
  });
}

function tail(items: TranscriptItem[]) {
  const rows = items.filter(
    (i): i is Extract<TranscriptItem, { kind: 'streaming' }> => i.kind === 'streaming',
  );
  return rows[rows.length - 1];
}

describe('mapTranscript 活动相位（#905）', () => {
  test('在跑步的活动接管标签，signalAt/labelVars 随行', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      activity: act(running.id, 'tool', { tool: 'bash' }),
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '正在执行工具：{n}',
      labelVars: { n: 'bash' },
      signalAt: NOW - 2_000,
    });
  });

  test('W1: stepId 不匹配（陈旧步相位）→ 基础标签原样、无 signalAt', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      activity: act('step-previous-run', 'thinking'),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '处理中...' });
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('W4: stopping 优先——「正在停止…」不被活动标签劫持', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      stopping: true,
      activity: act(running.id, 'thinking'),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '正在停止…' });
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('W5: 无活动信号 → 既有标签逐字不变（含 pending plan 的准备工作区）', () => {
    const pendingPlan = step('pending', 'plan');
    const items = render({ steps: [pendingPlan], activity: null });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '准备工作区...' });
    expect(tail(items)?.labelVars).toBeUndefined();
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('W6: 相位词表 8 件全有标签（穷尽）', () => {
    const running = step('claimed');
    const phases = [
      'preparing',
      'starting',
      'thinking',
      'responding',
      'tool',
      'retrying',
      'compacting',
      'awaiting_model',
    ] as const;
    for (const phase of phases) {
      const { label } = activityLabel(act(running.id, phase));
      expect(label.length).toBeGreaterThan(0);
      const items = render({ steps: [running], activity: act(running.id, phase) });
      expect(tail(items)?.label).toBe(label);
    }
  });
});

describe('mapTranscript 技能事实（#918）', () => {
  function toolMsg(
    id: string,
    call: Partial<ToolCallRecord> & { name: string },
    createdAt = NOW,
  ): import('../src/api/mappers.js').MessageRow {
    return {
      id,
      role: 'assistant',
      content: { kind: 'toolcall', call: { id, arguments: {}, ...call } },
      createdAt,
    } as unknown as import('../src/api/mappers.js').MessageRow;
  }

  const readSkill = (id: string, name: string, at = NOW) =>
    toolMsg(id, { name: 'read', arguments: { path: `/skills/${name}/SKILL.md` }, result: 'body', isError: false }, at);
  const deniedSkill = (id: string, name: string, at = NOW) =>
    toolMsg(
      id,
      {
        name: 'read',
        arguments: { path: `/skills/${name}/SKILL.md` },
        result: `read denied: skill '${name}' is not in the agent allowlist`,
        isError: true,
      },
      at,
    );

  function summary(items: TranscriptItem[]) {
    return items.find((i) => i.kind === 'skills');
  }

  test('W8: 在跑步 activity 的 skills 随行；陈旧步（stepId 不匹配）不串场', () => {
    const running = step('claimed');
    const facts = [
      { name: 'to-spec', denied: false },
      { name: 'extra-skill', denied: true },
    ];
    const items = render({
      steps: [running],
      activity: act(running.id, 'tool', { tool: 'skill: to-spec', skills: facts }),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', skills: facts });
    // 陈旧步的 activity（上一跑步）：skills 不得挂到当前 streaming 项。
    const stale = render({
      steps: [running],
      activity: act('step-previous-run', 'tool', { skills: facts }),
    });
    expect(tail(stale)?.skills).toBeUndefined();
  });

  test('W9: 汇总从落库行派生——首见序、去重、denied 粘滞两列互斥', () => {
    const items = render({
      messages: [
        readSkill('c1', 'to-spec', NOW - 5_000),
        deniedSkill('c2', 'extra-skill', NOW - 4_000),
        readSkill('c3', 'to-spec', NOW - 3_000), // 重复读：去重
        readSkill('c4', 'implement', NOW - 2_000),
        deniedSkill('c5', 'implement', NOW - 1_000), // 先读后拒：denied 粘滞
      ],
    });
    expect(summary(items)).toEqual({
      kind: 'skills',
      read: ['to-spec'],
      denied: ['extra-skill', 'implement'],
    });
  });

  test('W10: 对照组——无技能命中不产汇总条目；非技能工具行不算', () => {
    const plain = render({
      messages: [
        toolMsg('c1', { name: 'bash', arguments: { command: 'ls' }, result: 'x', isError: false }),
        toolMsg('c2', { name: 'read', arguments: { path: '/src/main.ts' }, result: 'y', isError: false }),
      ],
    });
    expect(summary(plain)).toBeUndefined();
    const running = step('claimed');
    const noSkills = render({ steps: [running], activity: act(running.id, 'thinking') });
    expect(tail(noSkills)?.skills).toBeUndefined();
  });

  test('W11: 半程行（无 result）不计入汇总；终态覆盖后计入', () => {
    const pending = render({
      messages: [toolMsg('c1', { name: 'read', arguments: { path: '/skills/x/SKILL.md' } })],
    });
    expect(summary(pending)).toBeUndefined();
    const settled = render({ messages: [readSkill('c1', 'x')] });
    expect(summary(settled)).toEqual({ kind: 'skills', read: ['x'], denied: [] });
  });
});

// —— 2026-10-13 发送黑盒拆除（静默表 + 过程时间线）的 mapper 半 ————————
// 失败方式（先固化；渲染半 = LiveRow 的 QUIET_AFTER_SECONDS 阈值与走表，
// live 探针在真栈驱动）：
//   W12 lastSignalAt 合成：相位 at 与 text_delta 时刻取新；只delta → delta；
//      只相位 → 相位；两源皆无 → 字段缺席（无信号面不摆数）
//   W13 phases 按在跑步 stepId 过滤——上一跑步的相位史不串到本步时间线
//   W14 排队行（pending + queue 投影）不挂静默表也不挂时间线——排队不是
//      执行态信号（相位是上一步残留，挂上是谎）

describe('mapTranscript 黑盒拆除（2026-10-13）', () => {
  test('W12: lastSignalAt = 相位 at 与 delta 时刻取新；两源皆无 = 缺席', () => {
    const running = step('claimed');
    const both = render({
      steps: [running],
      activity: act(running.id, 'thinking'), // at = NOW-2000
      lastTextDeltaAt: NOW - 500,
    });
    expect(tail(both)).toMatchObject({ kind: 'streaming', lastSignalAt: NOW - 500 });
    const deltaOnly = render({ steps: [running], activity: null, lastTextDeltaAt: NOW - 800 });
    expect(tail(deltaOnly)).toMatchObject({ kind: 'streaming', lastSignalAt: NOW - 800 });
    const none = render({ steps: [running], activity: null, lastTextDeltaAt: null });
    expect(tail(none)?.lastSignalAt).toBeUndefined();
  });

  test('W13: 在飞相位行只含在跑步的迁移史，陈旧步不串场', () => {
    const running = step('claimed');
    const history = [
      act(running.id, 'preparing', { at: NOW - 20_000 }),
      act(running.id, 'starting', { at: NOW - 18_000 }),
      act('step-previous-run', 'responding', { at: NOW - 60_000 }),
    ];
    const items = render({ steps: [running], phaseHistory: history });
    // 2026-10-13：相位迁移投影成对话正式行（kind:'phase'，streaming 行之前
    // 逐行追加），不再挂在 streaming.phases 子面板。陈旧步（previous-run）
    // 不产行。
    const phaseRows = items.filter((i) => i.kind === 'phase');
    expect(phaseRows.map((p) => (p.kind === 'phase' ? p.at : 0))).toEqual([
      NOW - 20_000,
      NOW - 18_000,
    ]);
    // streaming 行仍是尾行（相位行在它之前）。
    expect(tail(items)?.kind).toBe('streaming');
  });

  test('W14: 排队行不挂静默表与相位行（排队不是执行态信号）', () => {
    const pending = {
      ...step('pending'),
      queue: { position: 1, waitingFor: null },
    } as StepJournalRow;
    const items = render({
      steps: [pending],
      activity: act(pending.id, 'thinking'),
      lastTextDeltaAt: NOW - 500,
      phaseHistory: [act(pending.id, 'preparing', { at: NOW - 20_000 })],
    });
    const row = tail(items);
    expect(row?.label).toBe('排队中：等空闲机器（前面 {ahead} 个）');
    expect(row?.lastSignalAt).toBeUndefined();
    // 排队态不产在飞相位行（步没在跑）。
    expect(items.filter((i) => i.kind === 'phase')).toHaveLength(0);
  });
});

// —— 2026-10-13 dsh 回合过程折叠的 mapper 半 ————————————————————————
// 失败方式（先固化；渲染半 = ProcessGroup 的落定收拢与滑行，live 探针在
// 真栈驱动）：
//   P1 连续 thinking+tools 段收成一组（墙钟 = 首末时间窗）
//   P2 被答复行切开的两段各自成组（不跨内容合并）
//   P3 在飞（running 步在位）→ 末组 live=true 铺开，早先组照折
//   P4 无在跑步 → 全部 live=false（装载即折叠）
//   P5 无过程行 → 零组（对照组零噪声）

describe('mapTranscript 过程折叠（2026-10-13）', () => {
  const thinkMsg = (id: string, at: number): import('../src/api/mappers.js').MessageRow =>
    ({
      id,
      role: 'assistant',
      content: [{ type: 'thinking', thinking: `想一想 ${id}` }],
      createdAt: at,
    }) as unknown as import('../src/api/mappers.js').MessageRow;
  const toolMsg2 = (id: string, at: number): import('../src/api/mappers.js').MessageRow =>
    ({
      id,
      role: 'assistant',
      content: {
        kind: 'toolcall',
        call: { id, name: 'bash', arguments: { command: 'ls' }, result: 'ok', isError: false },
      },
      createdAt: at,
    }) as unknown as import('../src/api/mappers.js').MessageRow;
  const robotMsg = (id: string, at: number): import('../src/api/mappers.js').MessageRow =>
    ({
      id,
      role: 'assistant',
      content: [{ type: 'text', text: `答复 ${id}` }],
      createdAt: at,
    }) as unknown as import('../src/api/mappers.js').MessageRow;
  const groups = (items: TranscriptItem[]) =>
    items.filter((i): i is Extract<TranscriptItem, { kind: 'process' }> => i.kind === 'process');

  test('P1: 连续 thinking+tools 收成一组，墙钟取首末时间窗', () => {
    const items = render({
      messages: [thinkMsg('t1', 1_000), toolMsg2('c1', 5_000), toolMsg2('c2', 9_000)],
    });
    expect(groups(items)).toHaveLength(1);
    const g = groups(items)[0];
    expect(g?.parts.map((p) => p.kind)).toEqual(['thinking', 'tools']);
    expect(g?.seconds).toBe(8); // (9000-1000)/1000
    expect(g?.live).toBe(false);
    expect(g?.id).toBe('t1');
  });

  test('P2: 答复行切开的两段各自成组', () => {
    const items = render({
      messages: [thinkMsg('t1', 1_000), robotMsg('r1', 2_000), toolMsg2('c1', 5_000)],
    });
    expect(groups(items)).toHaveLength(2);
  });

  test('P3: 在飞回合的末组铺开（live=true），早先组照折', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      messages: [toolMsg2('c1', 1_000), robotMsg('r1', 2_000), toolMsg2('c2', 5_000)],
    });
    const gs = groups(items);
    expect(gs).toHaveLength(2);
    expect(gs[0]?.live).toBe(false);
    expect(gs[1]?.live).toBe(true);
  });

  test('P4: 无在跑步 → 全部折叠（装载即落定）', () => {
    const items = render({ messages: [toolMsg2('c1', 1_000)] });
    expect(groups(items)[0]?.live).toBe(false);
  });

  test('P5: 无过程行 → 零组', () => {
    const items = render({ messages: [robotMsg('r1', 1_000)] });
    expect(groups(items)).toHaveLength(0);
  });
});

// —— 2026-10-13 失败行双渲染修复 ————————————————————————————————————
// 失败方式（先固化）：D1 runtime 把终末错误同时落成 assistant 文本行与
// build.errorMessage → robot 行与失败行同文双渲染（用户读成「有回复」）；
// D2 误伤：尾部 robot 行与 errorMessage 不同文（正常失败 = agent 遗言 +
// 失败面各说各话）时不得让位。
describe('mapTranscript 失败行去重（2026-10-13）', () => {
  const FAIL_BUILD: BuildRecord = { ...BUILD, errorMessage: '模型上下文打满，自动压缩失败' };
  const errMsg = (id: string, text: string, at = NOW): import('../src/api/mappers.js').MessageRow =>
    ({
      id,
      role: 'assistant',
      content: [{ type: 'text', text }],
      createdAt: at,
    }) as unknown as import('../src/api/mappers.js').MessageRow;
  const renderFailed = (messages: import('../src/api/mappers.js').MessageRow[]) =>
    mapTranscript({
      messages,
      steps: [],
      plans: [],
      build: FAIL_BUILD,
      todo: todo(9, 'failed'),
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });

  test('D1: 尾部 robot 行与 errorMessage 同文 → 让位，只剩失败行一份', () => {
    const items = renderFailed([errMsg('m1', '模型上下文打满，自动压缩失败')]);
    expect(items.filter((i) => i.kind === 'fail')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'robot')).toHaveLength(0);
  });

  test('D2: 不同文 → 不让位（agent 遗言与失败面各自保留）', () => {
    const items = renderFailed([errMsg('m1', '写到一半断了')]);
    expect(items.filter((i) => i.kind === 'robot')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'fail')).toHaveLength(1);
  });
});

// —— 2026-10-13 内容行时刻普惠（用户 review 钉「对方没有时间」）———————
// 失败方式（先固化）：C1 plan 卡无 clock → 方案行动作行缺时刻；C2 review
// verdict 行无 clock → 审核卡动作行缺时刻；D3 fail 让位时 clock 随被
// splice 的 robot 行一起消失 → 失败面缺时刻（时刻属同一终末事件，不随面
// 退场）。对照零回归（fixture 捕获形无 clock 字段 → 不摆假时刻）由
// chat-type-measure 的捕获钉覆盖。
describe('mapTranscript 内容行时刻普惠（2026-10-13）', () => {
  test('C1: plan 卡带方案就绪时刻（step createdAt 优先于 plan createdAt）', () => {
    const items = mapTranscript({
      messages: [],
      steps: [step('pending', 'plan')],
      plans: [
        {
          id: 'plan-1',
          buildId: BUILD.id,
          version: 1,
          createdAt: NOW - 40_000,
          content: '# 方案标题\n第一段',
        } as unknown as import('../src/api/hooks.js').PlanRow,
      ],
      build: BUILD,
      todo: todo(9, 'building'),
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    const plan = items.find((i) => i.kind === 'plan');
    expect(plan?.kind === 'plan' && plan.clock === clockTime(NOW - 30_000)).toBe(true);
  });

  test('C2: review verdict 行带落库时刻', () => {
    const verdictMsg = {
      id: 'm-rev',
      role: 'system',
      content: JSON.stringify({
        kind: 'review_verdict',
        verdict: { conclusion: '方案通过', findings: [] },
      }),
      createdAt: NOW - 10_000,
    } as unknown as import('../src/api/mappers.js').MessageRow;
    const items = render({ messages: [verdictMsg] });
    const review = items.find((i) => i.kind === 'review');
    expect(review?.kind === 'review' && review.clock === clockTime(NOW - 10_000)).toBe(true);
  });

  test('D3: fail 让位继承被 splice robot 行的时刻', () => {
    const FAIL_BUILD: BuildRecord = { ...BUILD, errorMessage: '模型上下文打满，自动压缩失败' };
    const items = mapTranscript({
      messages: [
        {
          id: 'm-err',
          role: 'assistant',
          content: [{ type: 'text', text: '模型上下文打满，自动压缩失败' }],
          createdAt: NOW,
        } as unknown as import('../src/api/mappers.js').MessageRow,
      ],
      steps: [],
      plans: [],
      build: FAIL_BUILD,
      todo: todo(9, 'failed'),
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    const fail = items.find((i) => i.kind === 'fail');
    expect(fail?.kind === 'fail' && fail.clock === clockTime(NOW)).toBe(true);
  });
});

describe('mapChief 活动相位（#905 W7）', () => {
  // harness 同 chief-flight-expand.test.ts（#822）：封套最小形 + threads 走
  // opts；activeRun 在位（回合在飞）+ user 行 → 尾挂存在行。
  const ENV = {
    chief: {
      id: 'chief-u1-t1',
      userId: 'u1',
      teamId: 't1',
      agent: null,
      charter: null,
      lastTurnAt: null,
      createdAt: 0,
      tz: null,
      model: null,
    },
    agentActor: null,
    context: null,
    watches: [],
    wakes: [],
  } as unknown as Parameters<typeof mapChief>[0];

  const THREAD = {
    id: 'chief-bbb',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: '线程乙',
    createdAt: 2,
    updatedAt: 2,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's2', openedAt: 2 },
    pendingSessionResumeAt: null,
    pinnedMachineId: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: { phase: 'chief' },
  } as unknown as import('@pacman/shared').ChiefThread;

  const USER = {
    id: 'AbCdEfGhIjKlMnOpQrStU',
    role: 'user',
    content: '派一下',
    createdAt: NOW,
  } as unknown as import('../src/api/mappers.js').MessageRow;

  function chiefOf(activity?: StepActivity | null) {
    return mapChief(ENV, {
      threads: [THREAD],
      activeThreadId: 'chief-bbb',
      messages: [USER],
      ...(activity !== undefined ? { activity } : {}),
    });
  }

  test('无活动 → 存在行标签「处理中...」原样（零回归）', () => {
    const row = chiefOf().stream?.at(-1);
    expect(row).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });

  test('thinking 相位接管标签 + signalAt 随行', () => {
    expect(chiefOf(act('step-chief-1', 'thinking')).stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '模型思考中...',
      signalAt: NOW - 2_000,
    });
  });

  test('tool 相位 → runningTool 投影（activeRun.tool 死位让位活信号）', () => {
    const vm = chiefOf(act('step-chief-1', 'tool', { tool: 'docs' }));
    expect(vm.runningTool).toBe('docs');
    expect(vm.stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '正在执行工具：{n}',
      labelVars: { n: 'docs' },
    });
  });
});

// —— #1108 排队行标签（pending 步「排队中」+ 位次 + 等待对象）———————————
// 失败方式（先于实现固化）：
//   Q1 pending + queue（带机器）→ 排队标签 + machine/running/cap/ahead 插值
//   Q2 pending + queue（未钉）→ 等空闲机器 + ahead
//   Q3 投影缺席（老 server / fixture）→ 既有标签逐字不变（零回归）
//   Q4 排队优先于陈旧活动相位（步没在跑，相位是上一步的残留）
//   Q5 claimed 步 → 处理中（queue 本就不挂 claimed 行）
//   Q6 chief turnQueue → 存在行同款排队标签；被领走（turnQueue 消失）→ 处理中

describe('mapTranscript 排队投影（#1108 Q1–Q5）', () => {
  function queuedStep(queue: NonNullable<StepJournalRow['queue']>): StepJournalRow {
    return { ...step('pending'), queue };
  }

  test('Q1: pending + queue 带机器 → 排队标签全插值', () => {
    const items = render({
      steps: [
        queuedStep({
          position: 2,
          waitingFor: { machineId: 'm1', name: 'xmonsMac', running: 2, capacity: 3 },
        }),
      ],
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）',
      labelVars: { machine: 'xmonsMac', running: 2, cap: 3, ahead: 1 },
    });
  });

  test('Q2: pending + queue 未钉 → 等空闲机器 + ahead', () => {
    const items = render({
      steps: [queuedStep({ position: 1, waitingFor: null })],
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '排队中：等空闲机器（前面 {ahead} 个）',
      labelVars: { ahead: 0 },
    });
  });

  test('Q3: 投影缺席（老 server）→ 既有标签逐字不变', () => {
    const firstPlan = step('pending', 'plan');
    const items = render({ steps: [firstPlan] });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '准备工作区...' });
    const laterStep = { ...step('pending', 'build') };
    const items2 = render({ steps: [step('done', 'plan'), laterStep] });
    expect(tail(items2)).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });

  test('Q4: 排队优先于陈旧活动相位（步没在跑）', () => {
    const pending = queuedStep({ position: 1, waitingFor: null });
    const items = render({
      steps: [pending],
      activity: act(pending.id, 'thinking'), // 陈旧相位不得盖排队态
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '排队中：等空闲机器（前面 {ahead} 个）',
    });
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('Q5: claimed 步 → 处理中（现状锁）', () => {
    const items = render({ steps: [step('claimed')] });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });
});

describe('mapChief 排队投影（#1108 Q6）', () => {
  // harness 同 W7 块（作用域不跨 describe，本块自持一份）。
  const ENV_Q = {
    chief: {
      id: 'chief-u1-t1',
      userId: 'u1',
      teamId: 't1',
      agent: null,
      charter: null,
      lastTurnAt: null,
      createdAt: 0,
      tz: null,
      model: null,
    },
    agentActor: null,
    context: null,
    watches: [],
    wakes: [],
  } as unknown as Parameters<typeof mapChief>[0];

  const THREAD_Q = {
    id: 'chief-bbb',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: '线程乙',
    createdAt: 2,
    updatedAt: 2,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's2', openedAt: 2 },
    pendingSessionResumeAt: null,
    pinnedMachineId: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: { phase: 'chief' },
  } as unknown as import('@pacman/shared').ChiefThread;

  const USER_Q = {
    id: 'AbCdEfGhIjKlMnOpQrStU',
    role: 'user',
    content: '派一下',
    createdAt: NOW,
  } as unknown as import('../src/api/mappers.js').MessageRow;

  function chiefOfThread(thread: import('@pacman/shared').ChiefThread) {
    return mapChief(ENV_Q, {
      threads: [thread],
      activeThreadId: 'chief-bbb',
      messages: [USER_Q],
    });
  }

  test('Q6: turnQueue 带机器 → 存在行排队标签；消失 → 处理中', () => {
    expect(
      chiefOfThread({
        ...THREAD_Q,
        turnQueue: {
          position: 3,
          waitingFor: { machineId: 'm1', name: 'xmonsMac', running: 2, capacity: 2 },
        },
      }).stream?.at(-1),
    ).toMatchObject({
      kind: 'streaming',
      label: '排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）',
      labelVars: { machine: 'xmonsMac', running: 2, cap: 2, ahead: 2 },
    });
    expect(
      chiefOfThread({ ...THREAD_Q, turnQueue: { position: 1, waitingFor: null } }).stream?.at(-1),
    ).toMatchObject({
      kind: 'streaming',
      label: '排队中：等空闲机器（前面 {ahead} 个）',
      labelVars: { ahead: 0 },
    });
    // 被领取（turnQueue 退场）→ 既有存在行收敛。
    expect(chiefOfThread({ ...THREAD_Q }).stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '处理中...',
    });
  });
});

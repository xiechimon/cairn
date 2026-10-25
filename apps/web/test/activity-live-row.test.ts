import type { BuildRecord, StepActivity, StepJournalRow, ToolCallRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { activityLabel } from '../src/api/activity.js';
import { mapChief, mapTranscript } from '../src/api/mappers.js';
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
  });
}

function tail(items: TranscriptItem[]) {
  const rows = items.filter(
    (i): i is Extract<TranscriptItem, { kind: 'streaming' }> => i.kind === 'streaming',
  );
  return rows[rows.length - 1];
}

describe('mapTranscript activity phase (#905)', () => {
  test('running activity takes over the label, signalAt/labelVars come along', () => {
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

  test('W1: stepId mismatch (stale step phase) → base label unchanged, no signalAt', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      activity: act('step-previous-run', 'thinking'),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '处理中...' });
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('W4: stopping wins — `正在停止…` is not hijacked by the activity label', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      stopping: true,
      activity: act(running.id, 'thinking'),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '正在停止…' });
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('W5: no activity signal → existing labels verbatim unchanged (including the pending-plan preparation workspace)', () => {
    const pendingPlan = step('pending', 'plan');
    const items = render({ steps: [pendingPlan], activity: null });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '准备工作区...' });
    expect(tail(items)?.labelVars).toBeUndefined();
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('W6: all 8 vocab phase words have labels (exhaustive)', () => {
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

describe('mapTranscript skill facts (#918)', () => {
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

  test('W8: skills of the running activity come along; stale steps (stepId mismatch) do not cross over', () => {
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

    const stale = render({
      steps: [running],
      activity: act('step-previous-run', 'tool', { skills: facts }),
    });
    expect(tail(stale)?.skills).toBeUndefined();
  });

  test('W9: summary derives from stored rows — first-seen order, dedup, denied sticky across the two mutually exclusive columns', () => {
    const items = render({
      messages: [
        readSkill('c1', 'to-spec', NOW - 5_000),
        deniedSkill('c2', 'extra-skill', NOW - 4_000),
        readSkill('c3', 'to-spec', NOW - 3_000),
        readSkill('c4', 'implement', NOW - 2_000),
        deniedSkill('c5', 'implement', NOW - 1_000),
      ],
    });
    expect(summary(items)).toEqual({
      kind: 'skills',
      read: ['to-spec'],
      denied: ['extra-skill', 'implement'],
    });
  });

  test('W10: control group — no skill hits produce no summary entries; non-skill tool rows do not count', () => {
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

  test('W11: half-run rows (no result) do not count into the summary; after the final state covers them they do', () => {
    const pending = render({
      messages: [toolMsg('c1', { name: 'read', arguments: { path: '/skills/x/SKILL.md' } })],
    });
    expect(summary(pending)).toBeUndefined();
    const settled = render({ messages: [readSkill('c1', 'x')] });
    expect(summary(settled)).toEqual({ kind: 'skills', read: ['x'], denied: [] });
  });
});

describe('mapChief activity phase (#905 W7)', () => {

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
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: { phase: 'chief' },
  } as unknown as import('@cairn/shared').ChiefThread;

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

  test('no activity → presence row label `处理中...` unchanged (zero regression)', () => {
    const row = chiefOf().stream?.at(-1);
    expect(row).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });

  test('thinking phase takes over the label + signalAt comes along', () => {
    expect(chiefOf(act('step-chief-1', 'thinking')).stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '模型思考中...',
      signalAt: NOW - 2_000,
    });
  });

  test('tool phase → runningTool projection (the dead activeRun.tool slot yields to the live signal)', () => {
    const vm = chiefOf(act('step-chief-1', 'tool', { tool: 'docs' }));
    expect(vm.runningTool).toBe('docs');
    expect(vm.stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '正在执行工具：{n}',
      labelVars: { n: 'docs' },
    });
  });
});

describe('mapTranscript queue projection (#1108 Q1–Q5)', () => {
  function queuedStep(queue: NonNullable<StepJournalRow['queue']>): StepJournalRow {
    return { ...step('pending'), queue };
  }

  test('Q1: pending + queue with machine → queue label fully interpolated', () => {
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

  test('Q2: pending + queue without pinned machine → waiting-for-free-machine + ahead', () => {
    const items = render({
      steps: [queuedStep({ position: 1, waitingFor: null })],
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '排队中：等空闲机器（前面 {ahead} 个）',
      labelVars: { ahead: 0 },
    });
  });

  test('Q3: projection absent (old server) → existing labels verbatim unchanged', () => {
    const firstPlan = step('pending', 'plan');
    const items = render({ steps: [firstPlan] });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '准备工作区...' });
    const laterStep = { ...step('pending', 'build') };
    const items2 = render({ steps: [step('done', 'plan'), laterStep] });
    expect(tail(items2)).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });

  test('Q4: queue wins over a stale activity phase (the step is not running)', () => {
    const pending = queuedStep({ position: 1, waitingFor: null });
    const items = render({
      steps: [pending],
      activity: act(pending.id, 'thinking'),
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '排队中：等空闲机器（前面 {ahead} 个）',
    });
    expect(tail(items)?.signalAt).toBeUndefined();
  });

  test('Q5: claimed step → `处理中` (current behavior locked)', () => {
    const items = render({ steps: [step('claimed')] });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });
});

describe('mapChief queue projection (#1108 Q6)', () => {

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
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: { phase: 'chief' },
  } as unknown as import('@cairn/shared').ChiefThread;

  const USER_Q = {
    id: 'AbCdEfGhIjKlMnOpQrStU',
    role: 'user',
    content: '派一下',
    createdAt: NOW,
  } as unknown as import('../src/api/mappers.js').MessageRow;

  function chiefOfThread(thread: import('@cairn/shared').ChiefThread) {
    return mapChief(ENV_Q, {
      threads: [thread],
      activeThreadId: 'chief-bbb',
      messages: [USER_Q],
    });
  }

  test('Q6: turnQueue with machine → presence-row queue label; when it disappears → `处理中`', () => {
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

    expect(chiefOfThread({ ...THREAD_Q }).stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '处理中...',
    });
  });
});

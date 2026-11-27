import type { BuildRecord, StepActivity, StepJournalRow, ToolCallRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { activityLabel } from '../src/api/activity.js';
import { mapChief, mapTranscript } from '../src/api/mappers.js';
import type { TranscriptItem } from '../src/fixtures/records.js';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';
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
  test('running activity takes over the label, labelVars come along', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      activity: act(running.id, 'tool', { tool: 'bash' }),
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '正在执行工具：{n}',
      labelVars: { n: 'bash' },
    });
  });

  test('running output tokens reach the live row only from this step and only when non-zero', () => {
    const running = step('claimed');
    const tokens = { input: 52_000, output: 1_234 };
    expect(tail(render({ steps: [running], activity: act(running.id, 'thinking', { tokens }) }))).toMatchObject({
      outputTokens: 1_234,
    });
    for (const activity of [
      act(running.id, 'thinking'),
      act(running.id, 'thinking', { tokens: { input: 9, output: 0 } }),
      act('other-step', 'thinking', { tokens }),
    ]) {
      expect(tail(render({ steps: [running], activity }))).not.toHaveProperty('outputTokens');
    }
  });

  test('while a tool runs the status row is hidden, so the running work block carries the count', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      activity: act(running.id, 'tool', { tool: 'bash', tokens: { input: 7_000, output: 2_400 } }),
      messages: [
        {
          id: 'm-run',
          role: 'assistant',
          createdAt: NOW - 1_000,
          content: { kind: 'toolcall', call: { id: 'c-run', name: 'bash', arguments: { command: 'python3 fib.py' } } },
        },
      ],
    });
    expect(items.some((i) => i.kind === 'streaming')).toBe(false);
    expect(items.find((i) => i.kind === 'work')).toMatchObject({ running: true, outputTokens: 2_400 });
  });

  test('while the reply streams, the status row stays under it with the running count', () => {
    const running = step('claimed');
    const items = mapTranscript({
      messages: [],
      steps: [running],
      build: BUILD,
      todo: todo(9, 'building'),
      machineName: null,
      userName: 'Xmon Dai',
      liveText: 'Writing the summary now',
      activity: act(running.id, 'responding', { tokens: { input: 900, output: 1_500 } }),
    });
    expect(items.slice(-2).map((i) => i.kind)).toEqual(['robot', 'streaming']);
    expect(tail(items)).toMatchObject({ outputTokens: 1_500 });
  });

  test('W1: stepId mismatch (stale step phase) → base label unchanged', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      activity: act('step-previous-run', 'thinking'),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '处理中…' });
  });

  test('W4: stopping wins — `正在停止…` is not hijacked by the activity label', () => {
    const running = step('claimed');
    const items = render({
      steps: [running],
      stopping: true,
      activity: act(running.id, 'thinking'),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '正在停止…' });
  });

  test('W5: no activity signal → existing labels verbatim unchanged (including the pending-plan preparation workspace)', () => {
    const pendingPlan = step('pending', 'plan');
    const items = render({ steps: [pendingPlan], activity: null });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '准备工作区…' });
    expect(tail(items)?.labelVars).toBeUndefined();
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

  test('no activity → presence row label `处理中…` unchanged (zero regression)', () => {
    const row = chiefOf().stream?.at(-1);
    expect(row).toMatchObject({ kind: 'streaming', label: '处理中…' });
  });

  test('thinking phase takes over the label + signalAt comes along', () => {
    expect(chiefOf(act('step-chief-1', 'thinking')).stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '模型思考中…',
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

  test.each([
    ['a named machine with steps ahead', { position: 2, waitingFor: { machineId: 'm1', name: 'studioMac' } }],
    ['any free Runner', { position: 1, waitingFor: null }],
    [
      'an offline machine',
      {
        position: 1,
        waitingFor: { machineId: 'm1', name: 'studioMac' },
        blocked: { kind: 'machine-offline' as const, missing: [] },
      },
    ],
    [
      'an offline machine of a platform',
      {
        position: 3,
        waitingFor: { machineId: 'm1', name: 'studioMac' },
        blocked: { kind: 'machine-offline' as const, missing: [], platform: 'macos' as const },
      },
    ],
  ])('a step waiting for %s shows the ordinary preparing row, never a queue sentence', (_, queue) => {
    const row = tail(render({ steps: [queuedStep(queue)] })) as {
      blocked?: boolean;
      label: string;
      labelVars?: Record<string, string | number>;
    };
    expect(row).toMatchObject({ kind: 'streaming', label: '准备工作区…' });
    expect(row.blocked).toBeUndefined();
    expect(translate('zh', EN, row.label, row.labelVars)).not.toMatch(/排队|前面/);
  });

  test('Q2b: a refusal with no named machine keeps each locale in its own language', () => {
    const items = render({
      steps: [
        queuedStep({
          position: 1,
          waitingFor: null,
          blocked: { kind: 'runtime-disabled', missing: ['codex'] },
        }),
      ],
    });
    const row = tail(items) as {
      blocked?: boolean;
      blockedKind?: string;
      label: string;
      labelVars: Record<string, string | number>;
    };
    expect(row.blocked).toBe(true);
    expect(row.blockedKind).toBe('runtime-disabled');
    expect(translate('zh', EN, row.label, row.labelVars)).toBe(
      '排队中：执行机上未检测到 codex，安装后重启执行机',
    );
    expect(translate('en', EN, row.label, row.labelVars)).toBe(
      'Queued: the Runner has not detected codex. Install it, then restart the Runner',
    );
  });

  test('a step pinned to a retired machine names it and says the step is not reassigned', () => {
    const items = render({
      steps: [
        queuedStep({
          position: 1,
          waitingFor: { machineId: 'm1', name: 'studioMac' },
          blocked: { kind: 'machine-retired', missing: [] },
        }),
      ],
    });
    const row = tail(items) as {
      blocked?: boolean;
      blockedKind?: string;
      label: string;
      labelVars: Record<string, string | number>;
    };
    expect(row.blocked).toBe(true);
    expect(row.blockedKind).toBe('machine-retired');
    expect(translate('zh', EN, row.label, row.labelVars)).toBe(
      '排队中：studioMac 已删除或注销，这一步不会改派——重新注册这台执行机，或在「设置 → 模型」中重新配置',
    );
    expect(translate('en', EN, row.label, row.labelVars)).toBe(
      'Queued: studioMac is deleted or revoked and this step is not moved to another Runner. Register that Runner again, or update the configuration under Settings → Model',
    );
  });

  test('a step held behind another task names the task, not a machine', () => {
    const items = render({
      steps: [
        queuedStep({
          position: 1,
          waitingFor: null,
          blocked: { kind: 'blocked-by', missing: ['Write the spec'] },
        }),
      ],
    });
    const row = tail(items) as {
      blocked?: boolean;
      blockedKind?: string;
      label: string;
      labelVars: Record<string, string | number>;
    };
    expect(row.blocked).toBe(true);
    expect(row.blockedKind).toBe('blocked-by');
    expect(row.label).toBe('等「{title}」');
    expect(row.labelVars).toEqual({ title: 'Write the spec' });
    expect(translate('en', EN, row.label, row.labelVars)).toBe('Waits for “Write the spec”');
  });

  test('several unfinished blockers read as a count, like the task row', () => {
    const items = render({
      steps: [
        queuedStep({
          position: 1,
          waitingFor: null,
          blocked: { kind: 'blocked-by', missing: ['Write the spec', 'Cut the release'] },
        }),
      ],
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '等 {n} 个任务',
      labelVars: { n: 2 },
    });
  });

  test('a held step whose blockers just resolved falls back to the generic wait', () => {
    const items = render({
      steps: [
        queuedStep({
          position: 1,
          waitingFor: null,
          blocked: { kind: 'blocked-by', missing: [] },
        }),
      ],
    });
    expect(tail(items)).toMatchObject({
      kind: 'streaming',
      label: '等前置任务完成。',
    });
  });

  test('Q3: projection absent (old server) → existing labels verbatim unchanged', () => {
    const firstPlan = step('pending', 'plan');
    const items = render({ steps: [firstPlan] });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '准备工作区…' });
    const laterStep = { ...step('pending', 'build') };
    const items2 = render({ steps: [step('done', 'plan'), laterStep] });
    expect(tail(items2)).toMatchObject({ kind: 'streaming', label: '处理中…' });
  });

  test('Q4: queue wins over a stale activity phase (the step is not running)', () => {
    const pending = queuedStep({ position: 1, waitingFor: null });
    const items = render({
      steps: [pending],
      activity: act(pending.id, 'thinking'),
    });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '准备工作区…' });
  });

  test('Q5: claimed step → `处理中` (current behavior locked)', () => {
    const items = render({ steps: [step('claimed')] });
    expect(tail(items)).toMatchObject({ kind: 'streaming', label: '处理中…' });
  });
});

describe('mapChief queue projection (#1108 Q6)', () => {

  const ENV_Q = {
    chief: {
      id: 'chief-u1-t1',
      userId: 'u1',
      teamId: 't1',
      agent: null,
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

  test('Q6: turnQueue with machine → one connecting verb and no queue detail; when it disappears → `处理中`', () => {
    const queuedTail = chiefOfThread({
      ...THREAD_Q,
      turnQueue: { position: 3, waitingFor: { machineId: 'm1', name: 'studioMac' } },
    }).stream?.at(-1);
    expect(queuedTail).not.toHaveProperty('labelDetail');
    expect(
      chiefOfThread({
        ...THREAD_Q,
        turnQueue: {
          position: 3,
          waitingFor: { machineId: 'm1', name: 'studioMac' },
        },
      }).stream?.at(-1),
    ).toMatchObject({
      kind: 'streaming',
      label: '正在连接 {machine}…',
      labelVars: { machine: 'studioMac' },
    });
    expect(
      chiefOfThread({ ...THREAD_Q, turnQueue: { position: 1, waitingFor: null } }).stream?.at(-1),
    ).toMatchObject({
      kind: 'streaming',
      label: '处理中…',
    });

    expect(chiefOfThread({ ...THREAD_Q }).stream?.at(-1)).toMatchObject({
      kind: 'streaming',
      label: '处理中…',
    });
  });

  test('Q7: an offline Runner projects its notice kind and machine', () => {
    expect(
      chiefOfThread({
        ...THREAD_Q,
        turnQueue: {
          position: 1,
          waitingFor: { machineId: 'm1', name: 'studioMac' },
          blocked: { kind: 'machine-offline', missing: [] },
        },
      }).stream?.at(-1),
    ).toMatchObject({
      kind: 'streaming',
      label: '排队中：等执行机上线',
      queueWait: { kind: 'machine-offline', machine: 'studioMac' },
    });
  });

  test('Q8: an unroutable Coordinator names its one cause and carries the kind its fix links need', () => {
    expect(
      chiefOfThread({
        ...THREAD_Q,
        turnQueue: {
          position: 1,
          waitingFor: null,
          blocked: { kind: 'coordinator-provider-no-key', missing: ['deepseek'] },
        },
      }).stream?.at(-1),
    ).toMatchObject({
      kind: 'streaming',
      blocked: true,
      blockedKind: 'coordinator-provider-no-key',
      label: 'Coordinator 规则用的服务商「{name}」没有 API key',
      labelVars: { name: 'deepseek' },
    });
  });
});

// #1208 机器分歧标注（mapper 半）：todo 钉了机器而实际执行/钉选机器不同名
// → meta 机器行带钉选机器名（行尾「（任务钉选 {machine}）」）。失败方式
// 清单（先固化；渲染半在 live 探针与 e2e 面）：
//   P1 分歧 = 改派可见：todo 钉 mea、machineField 是别机 → todoPinnedMachine = mea
//   P2 钉选被遵守 = 零噪声：todo 钉 mea、machineField = mea → null
//   P3 未钉（自动）行为不变：machineId null → 恒 null
//   P4 无机器可显（步未领且 build 无钉）→ null（行本身不渲染）
//   P5 回归：machine / machineWaiting 投影不受本字段影响
// 分歧的唯一现实来源 = run_builds 显式 machineId 改派（派发面 pin 是硬
// 约束，别机领不到——machine-pin.test.ts 失败方式 4/6 钉死）；标注的职责
// 是让「选 A 结果在 B 跑」在看板层不再静默。

import type { TodoRecord as WireTodo } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { buildTaskMeta } from '../src/detail/task-meta.js';
import { NOW } from './helpers.js';

const wireTodo = (machineId: string | null): WireTodo =>
  ({
    id: 'todo-1',
    teamId: 'team-1',
    projectId: 'proj-1',
    title: 'machine pin dispatch',
    spec: 'spec',
    phase: 'queued',
    phaseAt: NOW,
    seqNum: 1,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: 'build-1',
    lastRunAt: NOW,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 2,
    createdBy: null,
    ownerId: null,
    sourceBuildId: null,
    sourceKind: null,
    sourceRef: null,
    machineId,
  }) as WireTodo;

function meta(input: {
  machineField: string | null;
  todoPinnedMachine: string | null;
  machineId: string | null;
  machineWaiting?: boolean;
}) {
  return buildTaskMeta({
    live: true,
    wireTodo: wireTodo(input.machineId),
    buildId: 'build-1',
    build: undefined,
    machineField: input.machineField,
    machineWaiting: input.machineWaiting ?? false,
    todoPinnedMachine: input.todoPinnedMachine,
    agentModel: null,
    usage: undefined,
    sourceEchoTitle: undefined,
  });
}

describe('#1208 任务钉选分歧标注（buildTaskMeta）', () => {
  test('P1 分歧 = 改派可见：todo 钉 mea、machineField 是别机 → todoPinnedMachine = mea', () => {
    const out = meta({ machineId: 'm-mea', todoPinnedMachine: 'mea', machineField: 'xmonsMac-3574.local' });
    expect(out?.todoPinnedMachine).toBe('mea');
  });

  test('P2 钉选被遵守 = 零噪声：todo 钉 mea、machineField = mea → null', () => {
    const out = meta({ machineId: 'm-mea', todoPinnedMachine: 'mea', machineField: 'mea' });
    expect(out?.todoPinnedMachine).toBeNull();
  });

  test('P3 未钉（自动）行为不变：machineId null → 恒 null', () => {
    const out = meta({ machineId: null, todoPinnedMachine: null, machineField: 'xmonsMac-3574.local' });
    expect(out?.todoPinnedMachine).toBeNull();
  });

  test('P4 无机器可显（machineField null）→ null', () => {
    const out = meta({ machineId: 'm-mea', todoPinnedMachine: 'mea', machineField: null });
    expect(out?.todoPinnedMachine).toBeNull();
  });

  test('P5 回归：machine / machineWaiting 投影不受本字段影响', () => {
    const out = meta({
      machineId: 'm-mea',
      todoPinnedMachine: 'mea',
      machineField: 'xmonsMac-3574.local',
      machineWaiting: true,
    });
    expect(out?.machine).toBe('xmonsMac-3574.local');
    expect(out?.machineWaiting).toBe(true);
  });
});

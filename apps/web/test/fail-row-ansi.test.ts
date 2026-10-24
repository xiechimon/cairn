// #1262 失败行/运行历史的显示侧纯文本兜底：写入侧（daemon 落库前剥）覆盖
// 增量，这里钉 web 消费面——存量脏行（不迁移）与漏网路径的 errorMessage
// 在板面渲染前也剥。失败方式枚举先固化：
//   R1 失败行标题残留：mapTranscript 的 fail 项 title 带转义垃圾（板面主诉）。
//   R2 运行历史 meta 残留：mapRunHistory 的第 N 次运行行拼进原始转义。
//   R3 对照组：干净 errorMessage 逐字不变（零回归）。

import type { BuildRecord, TodoRecord as WireTodo } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapRunHistory, mapTranscript } from '../src/api/mappers.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const ESC = '\x1b';
/** 用户库实测污染样本首行（biome SGR + OSC8 全族代表形）。 */
const POLLUTED = `git commit failed (1): ${ESC}[0mapps/web/src/fixtures/fixtures.ts${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m1667${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m53${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m${ESC}]8;;https://biomejs.dev/linter/rules/use-template${ESC}\\lint/style/useTemplate${ESC}]8;;${ESC}\\`;
const CLEAN = 'git commit failed (1): apps/web/src/fixtures/fixtures.ts:1667:53 lint/style/useTemplate';

const POLLUTED_BUILD: BuildRecord = {
  id: 'build-ansi',
  todoId: 'local-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: POLLUTED,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

/** mapTranscript 面（DisplayTodo = fixture 形）与 mapRunHistory 面（wire 形）
 * 字段集不同：会话失败行用 fixture 记录，运行历史用补齐 wire 专属六列的形。 */
const FAILED_CARD: TodoRecord = {
  ...todo(1, 'failed'),
  latestBuildId: POLLUTED_BUILD.id,
  buildHistory: [{ buildId: POLLUTED_BUILD.id, createdAt: NOW - 60_000 }],
};

const FAILED_WIRE_CARD: WireTodo = {
  ...FAILED_CARD,
  assignment: null,
  agent: null,
  createdBy: null,
  ownerId: null,
  sourceBuildId: null,
  sourceKind: null,
  sourceRef: null,
  output: 'code',
};

describe('mapTranscript 失败行（#1262 兜底）', () => {
  test('R1：污染 errorMessage → fail 项 title 纯文本', () => {
    const items = mapTranscript({
      messages: [],
      steps: [],
      plans: [],
      build: POLLUTED_BUILD,
      todo: FAILED_CARD,
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    const fail = items.find((i): i is Extract<typeof i, { kind: 'fail' }> => i.kind === 'fail');
    expect(fail?.title).toBe(CLEAN);
  });

  test('R3：干净 errorMessage 逐字不变（零回归）', () => {
    const items = mapTranscript({
      messages: [],
      steps: [],
      plans: [],
      build: { ...POLLUTED_BUILD, errorMessage: CLEAN },
      todo: FAILED_CARD,
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    const fail = items.find((i): i is Extract<typeof i, { kind: 'fail' }> => i.kind === 'fail');
    expect(fail?.title).toBe(CLEAN);
  });
});

describe('mapRunHistory 运行历史（#1262 兜底）', () => {
  test('R2：污染 errorMessage → meta 纯文本（无转义残片）', () => {
    const rows = mapRunHistory(FAILED_WIRE_CARD, [POLLUTED_BUILD], NOW);
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? { meta: '', status: '' };
    expect(row.meta).not.toContain(ESC);
    expect(row.meta).not.toContain(']8;;');
    expect(row.meta).toContain(CLEAN.slice('git commit failed (1): '.length));
    expect(row.status).toBe('failed-current');
  });
});

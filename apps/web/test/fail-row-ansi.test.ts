import { type BuildRecord, buildFailureRowContent, type TodoRecord as WireTodo } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapRunHistory, mapTranscript } from '../src/api/mappers.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const ESC = '\x1b';

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

const FAILED_CARD: TodoRecord = {
  ...todo(1, 'failed'),
  latestBuildId: POLLUTED_BUILD.id,
  buildHistory: [{ buildId: POLLUTED_BUILD.id, createdAt: NOW - 60_000 }],
};

const FAILED_WIRE_CARD: WireTodo = {
  ...FAILED_CARD,
  createdBy: null,
  ownerId: null,
  sourceBuildId: null,
  sourceKind: null,
  sourceRef: null,
  owner: null,
  output: 'code',
};

describe('mapTranscript failure row (#1262 fallback)', () => {
  test('R1: polluted errorMessage → fail item raw plain text', () => {
    const items = mapTranscript({
      messages: [],
      steps: [],
      build: POLLUTED_BUILD,
      todo: FAILED_CARD,
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    const fail = items.find((i): i is Extract<typeof i, { kind: 'fail' }> => i.kind === 'fail');
    expect(fail?.raw).toBe(CLEAN);
  });

  test('R3: clean errorMessage verbatim unchanged (zero regression)', () => {
    const items = mapTranscript({
      messages: [],
      steps: [],
      build: { ...POLLUTED_BUILD, errorMessage: CLEAN },
      todo: FAILED_CARD,
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    const fail = items.find((i): i is Extract<typeof i, { kind: 'fail' }> => i.kind === 'fail');
    expect(fail?.raw).toBe(CLEAN);
  });
});

describe('mapTranscript disk-full failure copy', () => {
  test.each(['429', '500', '503', '529'])(
    'a status-like process id in the temp path still produces disk guidance: %s',
    (pid) => {
      const errorMessage = `Runner error: ENOSPC: no space left on device, open '/runner/home/.cairn/outbox/.step-example.json.${pid}.0.tmp'`;
      const items = mapTranscript({
        messages: [],
        steps: [],
        build: { ...POLLUTED_BUILD, errorMessage },
        todo: FAILED_CARD,
        machineName: null,
        userName: 'Xmon Dai',
        liveText: '',
      });
      const fail = items.find((i): i is Extract<typeof i, { kind: 'fail' }> => i.kind === 'fail');
      expect(fail).toMatchObject({
        label: '执行机磁盘已满',
        body: 'Cairn 无法写入本轮记录。请在这台执行机上腾出磁盘空间后重试。',
      });
    },
  );

  test('a parked disk-full system message without todo.retry still maps to disk title and guidance', () => {
    const content =
      "Task parked: runner disk full. Free disk space on the Runner, then retry. Last error: Runner error: ENOSPC: no space left on device, open '/runner/home/.cairn/outbox/.step-example.json.503.0.tmp'";
    const items = mapTranscript({
      messages: [{ id: 'retry-parked-build-ansi', role: 'system', content, createdAt: NOW }],
      steps: [],
      build: { ...POLLUTED_BUILD, errorMessage: content },
      todo: FAILED_CARD,
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    const fail = items.find((i): i is Extract<typeof i, { kind: 'fail' }> => i.kind === 'fail');
    expect(fail).toMatchObject({
      label: '执行机磁盘已满',
      body: 'Cairn 无法写入本轮记录。请在这台执行机上腾出磁盘空间后重试。',
    });
  });

  test('folds an adjacent retry-parked notice into the preceding step-failure row instead of rendering two fail rows', () => {
    const rawError =
      "Runner error: ENOSPC: no space left on device, open '/runner/home/.cairn/outbox/.step-example.json.503.0.tmp'";
    const stepFailContent = buildFailureRowContent({
      reason: rawError,
      commits: ['abcdef1234567'],
      pr: null,
    });
    const parkedContent = `Task parked: runner disk full. Free disk space on the Runner, then retry. Last error: ${rawError}`;
    const messages = [
      { id: 'sys-step-fail', role: 'system' as const, content: stepFailContent, createdAt: NOW },
      {
        id: 'retry-parked-build-ansi',
        role: 'system' as const,
        content: parkedContent,
        createdAt: NOW + 1,
      },
    ];
    for (const todoRecord of [
      FAILED_CARD,
      {
        ...FAILED_CARD,
        retry: {
          state: 'parked' as const,
          failureClass: 'permanent' as const,
          reasonCode: 'disk' as const,
          attemptsMade: 0,
          detail: null,
        },
      },
    ]) {
      const items = mapTranscript({
        messages,
        steps: [],
        build: { ...POLLUTED_BUILD, errorMessage: parkedContent },
        todo: todoRecord,
        machineName: null,
        userName: 'Xmon Dai',
        liveText: '',
      });
      const fails = items.filter((i): i is Extract<typeof i, { kind: 'fail' }> => i.kind === 'fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        label: '执行机磁盘已满',
        body: 'Cairn 无法写入本轮记录。请在这台执行机上腾出磁盘空间后重试。',
        raw: rawError,
        facts: { commits: ['abcdef123'] },
      });
    }
  });

  test('keeps two separate failed attempts separated by a user follow-up as two fail rows', () => {
    const rawError =
      "Runner error: ENOSPC: no space left on device, open '/runner/home/.cairn/outbox/.step-example.json.503.0.tmp'";
    const stepFailContent = buildFailureRowContent({ reason: rawError, commits: [], pr: null });
    const parkedContent = `Task parked: runner disk full. Free disk space on the Runner, then retry. Last error: ${rawError}`;
    const items = mapTranscript({
      messages: [
        { id: 'sys-fail-1', role: 'system' as const, content: stepFailContent, createdAt: NOW },
        { id: 'user-retry', role: 'user' as const, content: '已清理空间，再试一次', createdAt: NOW + 10 },
        { id: 'retry-parked-build-ansi', role: 'system' as const, content: parkedContent, createdAt: NOW + 20 },
      ],
      steps: [],
      build: { ...POLLUTED_BUILD, errorMessage: parkedContent },
      todo: FAILED_CARD,
      machineName: null,
      userName: 'Xmon Dai',
      liveText: '',
    });
    expect(items.filter((i) => i.kind === 'fail')).toHaveLength(2);
  });
});

describe('mapTranscript failure dedup', () => {
  const LEGACY_REPORT = (reason: string) =>
    [
      '构建步兜底报告：本步异常结束，以下由系统根据已知记录生成。',
      `- 失败原因：${reason}`,
      '- 已知改动：没有改动记录',
      '- 下一步：看过失败原因后带反馈重跑。',
    ].join('\n');

  test.each([CLEAN, `${CLEAN}\n`, ` ${CLEAN}  `])(
    'a stored row reason %j is not duplicated by the fallback when errorMessage matches loosely',
    (storedError) => {
      const items = mapTranscript({
        messages: [
          { id: 'm1', role: 'system' as const, content: LEGACY_REPORT(CLEAN), createdAt: 1 },
        ],
        steps: [],
        build: { ...POLLUTED_BUILD, errorMessage: storedError },
        todo: FAILED_CARD,
        machineName: null,
        userName: 'Xmon Dai',
        liveText: '',
      });
      expect(items.filter((i) => i.kind === 'fail')).toHaveLength(1);
    },
  );
});

describe('mapRunHistory run history (#1262 fallback)', () => {
  test('R2: polluted errorMessage → meta plain text (no escape fragments)', () => {
    const rows = mapRunHistory(FAILED_WIRE_CARD, [POLLUTED_BUILD], NOW);
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? { meta: '', status: '' };
    expect(row.meta).not.toContain(ESC);
    expect(row.meta).not.toContain(']8;;');
    expect(row.meta).toContain(CLEAN.slice('git commit failed (1): '.length));
    expect(row.status).toBe('failed-current');
  });
});

import type { BuildRecord, TodoRecord as WireTodo } from '@cairn/shared';
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
  assignment: null,
  agent: null,
  createdBy: null,
  ownerId: null,
  sourceBuildId: null,
  sourceKind: null,
  sourceRef: null,
  output: 'code',
};

describe('mapTranscript failure row (#1262 fallback)', () => {
  test('R1: polluted errorMessage → fail item title plain text', () => {
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

  test('R3: clean errorMessage verbatim unchanged (zero regression)', () => {
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

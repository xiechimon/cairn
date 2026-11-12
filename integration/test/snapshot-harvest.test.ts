import { createHash } from 'node:crypto';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { expect, it } from 'vitest';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import { coordinatorTurnSnapshot } from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { buildDatasetItem, listHarvestCandidates } from '../eval/coordinator-routing/harvest.mts';
import {
  harvestSnapshotReplayInput,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotToReplayInput,
} from '../eval/coordinator-routing/snapshot.mts';

const DAY = 86_400_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

type SealedRow = {
  turnId: string;
  teamId: string;
  sourceTraceId: string;
  schemaVersion: number;
  outcome: 'success' | 'failed' | 'stopped';
  capturedAt: number;
  expiresAt: number;
  status: 'sealed' | 'unusable';
  reason: string | null;
  redactionCount: number;
  payloadBytes: number;
  digest: string | null;
  payload: string | null;
};

function sealedRow(overrides: Partial<SealedRow> = {}): SealedRow {
  const payload = {
    claim: {
      systemPrompt: 'You are the Coordinator.',
      instruction: 'please create a task',
      trigger: 'user',
      memories: ['- 记忆文件：0 个'],
      provider: 'stub',
      modelId: 'm',
      thinkingLevel: null,
      volatileText: null,
      initialTodoIds: [],
      projects: [
        {
          id: 'p0',
          name: 'docs',
          description: null,
          repoKind: null,
          archivedAt: null,
        },
      ],
    },
    toolViews: [],
  };
  const payloadText = JSON.stringify(payload);
  return {
    turnId: 'turn-1',
    teamId: 't0',
    sourceTraceId: otlpTraceIdOfTurn('turn-1'),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    outcome: 'success',
    capturedAt: Number.MAX_SAFE_INTEGER - 30 * DAY,
    expiresAt: Number.MAX_SAFE_INTEGER,
    status: 'sealed',
    reason: null,
    redactionCount: 0,
    payloadBytes: Buffer.byteLength(payloadText, 'utf8'),
    digest: createHash('sha256').update(canonical(payload)).digest('hex'),
    payload: payloadText,
    ...overrides,
  };
}

it('keeps the sealed payload contract aligned with the server capture schema', () => {
  const payload = JSON.parse(sealedRow().payload as string) as { claim: Record<string, unknown> };
  expect(Object.keys(payload.claim).sort()).toEqual([
    'initialTodoIds',
    'instruction',
    'memories',
    'modelId',
    'projects',
    'provider',
    'systemPrompt',
    'thinkingLevel',
    'trigger',
    'volatileText',
  ]);
  expect(Object.keys(payload).sort()).toEqual(['claim', 'toolViews']);
});

it('freezes a sealed snapshot into a replay input with trace provenance', () => {
  const input = snapshotToReplayInput(sealedRow());
  expect(input.request).toBe('please create a task');
  expect(input.projects).toHaveLength(1);
  expect(input.projects[0]).toMatchObject({ id: 'p0', name: 'docs' });
  expect(input.snapshot.source).toBe('trace');
  expect(input.snapshot.sourceTraceId).toBe(otlpTraceIdOfTurn('turn-1'));
  expect(input.snapshot.todos).toHaveLength(0);
});

it('rejects every ineligible snapshot state fail-closed', () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    [
      'unusable',
      { status: 'unusable', reason: 'bounds', payload: null, digest: null },
      /incomplete: snapshot unusable/,
    ],
    ['failed outcome', { outcome: 'failed' }, /incomplete: snapshot outcome failed/],
    ['expired', { capturedAt: 1, expiresAt: 2 }, /incomplete: snapshot expired/],
    [
      'unknown schema version',
      { schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 },
      /incomplete: snapshot schema version/,
    ],
    [
      'trace identity mismatch',
      { sourceTraceId: 'f'.repeat(32) },
      /incomplete: snapshot trace identity mismatch/,
    ],
    ['digest mismatch', { digest: 'a'.repeat(64) }, /incomplete: snapshot digest mismatch/],
    ['redacted required input', { redactionCount: 2 }, /incomplete: snapshot required redaction/],
    ['no instruction', {}, /incomplete: snapshot has no submitted instruction/],
  ];
  const defaultClaim = JSON.parse(sealedRow().payload as string).claim;
  for (const [name, overrides, pattern] of cases) {
    const patchedPayloads = ['no instruction', 'pre-existing todos', 'tool views without closure'];
    const row = sealedRow(
      patchedPayloads.includes(name)
        ? {
            ...overrides,
            payload: JSON.stringify(
              name === 'no instruction'
                ? { claim: { ...defaultClaim, instruction: null }, toolViews: [] }
                : name === 'pre-existing todos'
                  ? { claim: { ...defaultClaim, initialTodoIds: ['todo-1'] }, toolViews: [] }
                  : {
                      claim: defaultClaim,
                      toolViews: [
                        {
                          callId: 'c1',
                          tool: 'projects',
                          params: {},
                          preCallTodos: [],
                          result: [],
                        },
                      ],
                    },
            ),
          }
        : overrides,
    );
    if (patchedPayloads.includes(name)) {
      row.digest = createHash('sha256')
        .update(canonical(JSON.parse(row.payload as string)))
        .digest('hex');
    }
    expect(() => snapshotToReplayInput(row), name).toThrow(pattern);
  }
});

it('reads a snapshot row by team and turn from the database', () => {
  const db = openDbWithHandle(':memory:');
  try {
    const { team: seeded } = seed(db.db);
    db.db
      .insert(coordinatorTurnSnapshot)
      .values(sealedRow({ teamId: seeded.id }))
      .run();
    const input = harvestSnapshotReplayInput(db.db, seeded.id, 'turn-1');
    expect(input.request).toBe('please create a task');
    expect(() => harvestSnapshotReplayInput(db.db, seeded.id, 'missing')).toThrow(
      'incomplete: snapshot row missing',
    );
    expect(() => harvestSnapshotReplayInput(db.db, 'other-team', 'turn-1')).toThrow(
      'incomplete: snapshot row missing',
    );
  } finally {
    db.close();
  }
});

it('lists harvest candidates and builds dataset items from sealed snapshots', () => {
  const db = openDbWithHandle(':memory:');
  try {
    const { team: seeded } = seed(db.db);
    const eligible = sealedRow({ teamId: seeded.id });
    db.db.insert(coordinatorTurnSnapshot).values(eligible).run();
    db.db
      .insert(coordinatorTurnSnapshot)
      .values(
        sealedRow({
          turnId: 'turn-2',
          teamId: seeded.id,
          sourceTraceId: otlpTraceIdOfTurn('turn-2'),
          status: 'unusable',
          reason: 'bounds',
          payload: null,
          payloadBytes: 0,
          digest: null,
        }),
      )
      .run();

    const candidates = listHarvestCandidates(db.db, seeded.id);
    expect(candidates).toHaveLength(2);
    const ok = candidates.find((c) => c.turnId === 'turn-1');
    expect(ok?.eligible).toBe(true);
    const bad = candidates.find((c) => c.turnId === 'turn-2');
    expect(bad?.eligible).toBe(false);
    expect(bad?.reason).toMatch(/^incomplete: snapshot unusable/);

    const item = buildDatasetItem(db.db, seeded.id, 'turn-1', null, 'routing');
    expect(item.datasetName).toBe('routing');
    expect(item.id).toBe('cairn-routing-turn-1');
    expect(item.sourceTraceId).toBe(otlpTraceIdOfTurn('turn-1'));
    expect(item.input.request).toBe('please create a task');
    expect(() => buildDatasetItem(db.db, seeded.id, 'turn-2', null, 'routing')).toThrow(
      'incomplete: snapshot unusable',
    );
  } finally {
    db.close();
  }
});

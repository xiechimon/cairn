import { createHash } from 'node:crypto';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { expect, it } from 'vitest';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import { coordinatorTurnSnapshot } from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
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
  for (const [name, overrides, pattern] of cases) {
    const row =
      name === 'no instruction'
        ? sealedRow({
            payload: JSON.stringify({
              claim: {
                ...JSON.parse(sealedRow().payload as string).claim,
                instruction: null,
              },
              toolViews: [],
            }),
          })
        : sealedRow(overrides);
    if (name === 'no instruction') {
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

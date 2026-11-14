import { createHash } from 'node:crypto';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { expect, it, vi } from 'vitest';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import { coordinatorTurnSnapshot } from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { COORDINATOR_SNAPSHOT_SCHEMA_VERSION } from '../../apps/server/src/services/coordinator-turn-capture.js';
import { replayInput } from '../eval/coordinator-routing/contract.mts';
import { buildDatasetItem, listHarvestCandidates } from '../eval/coordinator-routing/harvest.mts';
import {
  harvestSnapshotReplayInput,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotToReplayInput,
} from '../eval/coordinator-routing/snapshot.mts';
import { prepareItems, uploadItems } from '../eval/coordinator-routing/upload.mts';

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
      initialTodos: [
        {
          id: 'todo-seed',
          projectId: 'p0',
          title: 'seed task',
          spec: 'seed spec',
          phase: 'todo',
          phaseAt: 5,
          archivedAt: null,
          seqNum: 1,
          orderIndex: 0,
          blockedBy: [],
          latestBuildId: null,
          sourceKind: null,
          sourceRef: null,
          request: null,
          output: 'info',
        },
      ],
      initialThreads: [],
      initialVisible: [{ id: 'todo-seed', ownership: null, blocks: false }],
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
    'initialThreads',
    'initialTodos',
    'initialVisible',
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
  expect(input.snapshot.todos).toHaveLength(1);
  expect(input.snapshot.todos[0]).toMatchObject({ id: 'todo-seed', title: 'seed task' });
  expect(input.snapshot.visible).toEqual([{ id: 'todo-seed', ownership: null, blocks: false }]);
  expect(() => replayInput.parse(input)).not.toThrow();
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
    ['closure ownership drift', {}, /incomplete: snapshot does not map to a replay input/],
  ];
  const defaultClaim = JSON.parse(sealedRow().payload as string).claim;
  for (const [name, overrides, pattern] of cases) {
    const patchedPayloads = ['no instruction', 'closure ownership drift'];
    const row = sealedRow(
      patchedPayloads.includes(name)
        ? {
            ...overrides,
            payload: JSON.stringify(
              name === 'no instruction'
                ? { claim: { ...defaultClaim, instruction: null }, toolViews: [] }
                : {
                    claim: {
                      ...defaultClaim,
                      initialVisible: [{ id: 'todo-unknown', ownership: null, blocks: false }],
                    },
                    toolViews: [],
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

it('harvests only the schema version the Coordinator writes', () => {
  expect(COORDINATOR_SNAPSHOT_SCHEMA_VERSION).toBe(SNAPSHOT_SCHEMA_VERSION);
});

it('validates reviewed answers against the frozen snapshot before uploading anything', async () => {
  const db = openDbWithHandle(':memory:');
  try {
    const { team: seeded } = seed(db.db);
    db.db
      .insert(coordinatorTurnSnapshot)
      .values(sealedRow({ teamId: seeded.id }))
      .run();
    const route = {
      decision: 'route',
      parts: [{ project: 'docs' }],
      askCandidates: [],
      blockedBy: [],
    };

    expect(() =>
      prepareItems(
        db.db,
        seeded.id,
        [{ turnId: 'turn-1', expectedOutput: { ...route, parts: [{ project: 'nope' }] } }],
        'routing',
      ),
    ).toThrow(/turn-1: incomplete: invalid expectedOutput project reference/);
    expect(() =>
      prepareItems(
        db.db,
        seeded.id,
        [
          { turnId: 'turn-1', expectedOutput: route },
          { turnId: 'turn-1', expectedOutput: route },
        ],
        'routing',
      ),
    ).toThrow('incomplete: duplicate turn in reviewed file');
    expect(() =>
      prepareItems(db.db, seeded.id, [{ turnId: 'missing', expectedOutput: route }], 'routing'),
    ).toThrow(/missing: incomplete: snapshot row missing/);
    expect(() =>
      prepareItems(
        db.db,
        seeded.id,
        [{ turnId: 'turn-1', expectedOutput: { decision: 'x' } }],
        'routing',
      ),
    ).toThrow(/turn-1/);

    const items = prepareItems(
      db.db,
      seeded.id,
      [{ turnId: 'turn-1', expectedOutput: route }],
      'routing',
    );
    const send = vi.fn(async () => new Response('{}', { status: 200 }));
    const target = { baseUrl: 'http://langfuse.test/', publicKey: 'pk', secretKey: 'sk' };
    await expect(uploadItems(items, target, send as unknown as typeof fetch)).resolves.toBe(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://langfuse.test/api/public/dataset-items');
    expect(new Headers(init.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('pk:sk').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      datasetName: 'routing',
      id: 'cairn-routing-turn-1',
      sourceTraceId: otlpTraceIdOfTurn('turn-1'),
      status: 'ACTIVE',
      expectedOutput: route,
      input: { request: 'please create a task' },
    });

    const refuse = vi.fn(async () => new Response('no', { status: 403 }));
    await expect(uploadItems(items, target, refuse as unknown as typeof fetch)).rejects.toThrow(
      'cairn-routing-turn-1: Langfuse answered HTTP 403',
    );
  } finally {
    db.close();
  }
});

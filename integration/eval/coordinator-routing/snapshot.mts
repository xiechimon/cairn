import { createHash } from 'node:crypto';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../../apps/server/src/db/client.js';
import { coordinatorTurnSnapshot } from '../../../apps/server/src/db/schema.js';
import { type ReplayInput, replayInput } from './contract.mts';

export const SNAPSHOT_SCHEMA_VERSION = 1;

const sealedSnapshot = z.strictObject({
  claim: z.object({
    systemPrompt: z.string(),
    instruction: z.string().nullable(),
    trigger: z.string(),
    memories: z.array(z.string()),
    provider: z.string(),
    modelId: z.string(),
    thinkingLevel: z.string().nullable(),
    volatileText: z.string().nullable(),
    projects: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          repoKind: z.string().nullable(),
          archivedAt: z.number().nullable(),
        })
        .strict(),
    ),
  }),
  toolViews: z.array(
    z.object({
      callId: z.string(),
      tool: z.string(),
      params: z.record(z.string(), z.unknown()),
      preCallTodos: z.array(z.unknown()),
      result: z.unknown(),
    }),
  ),
});

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

export function snapshotToReplayInput(rawRow: {
  turnId: string;
  teamId: string;
  sourceTraceId: string;
  schemaVersion: number;
  outcome: string;
  capturedAt: number;
  expiresAt: number;
  status: string;
  reason: string | null;
  redactionCount: number;
  payloadBytes: number;
  digest: string | null;
  payload: string | null;
}): ReplayInput {
  const row = rawRow;
  if (row.status !== 'sealed') throw new Error(`incomplete: snapshot ${row.status}`);
  if (row.payload === null || row.digest === null)
    throw new Error('incomplete: snapshot missing payload');
  if (row.outcome !== 'success') throw new Error(`incomplete: snapshot outcome ${row.outcome}`);
  if (row.schemaVersion !== SNAPSHOT_SCHEMA_VERSION)
    throw new Error(`incomplete: snapshot schema version ${row.schemaVersion}`);
  if (row.sourceTraceId !== otlpTraceIdOfTurn(row.turnId))
    throw new Error('incomplete: snapshot trace identity mismatch');
  if (row.expiresAt <= Date.now()) throw new Error('incomplete: snapshot expired');
  if (row.redactionCount > 0) throw new Error('incomplete: snapshot required redaction');
  const payload = JSON.parse(row.payload) as unknown;
  if (createHash('sha256').update(canonical(payload)).digest('hex') !== row.digest)
    throw new Error('incomplete: snapshot digest mismatch');
  const parsed = sealedSnapshot.safeParse(payload);
  if (!parsed.success) throw new Error('incomplete: snapshot payload schema mismatch');
  if (parsed.data.claim.instruction === null)
    throw new Error('incomplete: snapshot has no submitted instruction');
  const input = replayInput.safeParse({
    request: parsed.data.claim.instruction,
    projects: parsed.data.claim.projects,
    snapshot: {
      source: 'trace',
      sourceTraceId: row.sourceTraceId,
      capturedAt: row.capturedAt,
      todos: [],
      threads: [],
      visible: [],
    },
  });
  if (!input.success) throw new Error('incomplete: snapshot does not map to a replay input');
  return input.data;
}

export function harvestSnapshotReplayInput(db: Db, teamId: string, turnId: string): ReplayInput {
  const row = db
    .select()
    .from(coordinatorTurnSnapshot)
    .where(eq(coordinatorTurnSnapshot.turnId, turnId))
    .get();
  if (row === undefined || row.teamId !== teamId)
    throw new Error('incomplete: snapshot row missing');
  return snapshotToReplayInput(row);
}

import { createHash } from 'node:crypto';
import { redactSecrets } from '@cairn/shared';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { coordinatorTurnSnapshot, type step, todo } from '../db/schema.js';

type StepRow = typeof step.$inferSelect;

export const COORDINATOR_SNAPSHOT_SCHEMA_VERSION = 1;
export const COORDINATOR_SNAPSHOT_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const COORDINATOR_SNAPSHOT_MAX_RECORDS = 10_000;
export const COORDINATOR_SNAPSHOT_MAX_CALL_VIEWS = 128;

export const CAPTURE_TOOLS = ['projects', 'create_todo'] as const;
export type CaptureTool = (typeof CAPTURE_TOOLS)[number];

const todoView = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  phase: z.string(),
  archivedAt: z.number().nullable(),
});

const toolView = z.object({
  callId: z.string(),
  tool: z.string(),
  params: z.record(z.string(), z.unknown()),
  preCallTodos: z.array(todoView),
  result: z.unknown(),
});

const snapshotPayload = z.object({
  toolViews: z.array(toolView),
});

export interface TurnCapture {
  readonly stepId: string;
  toolViews: z.infer<typeof toolView>[];
  recordCount: number;
}

export function isCaptureTool(name: string): name is CaptureTool {
  return (CAPTURE_TOOLS as readonly string[]).includes(name);
}

const liveCaptures = new Map<string, TurnCapture>();

export function openTurnCapture(stepId: string): TurnCapture {
  const existing = liveCaptures.get(stepId);
  if (existing) return existing;
  const capture: TurnCapture = { stepId, toolViews: [], recordCount: 0 };
  liveCaptures.set(stepId, capture);
  return capture;
}

export function takeTurnCapture(stepId: string): TurnCapture | undefined {
  const capture = liveCaptures.get(stepId);
  liveCaptures.delete(stepId);
  return capture;
}

export function captureToolBoundary(
  db: Db,
  stepId: string,
  teamId: string,
  tool: CaptureTool,
  callId: string | undefined,
  params: Record<string, unknown>,
  result: unknown,
): void {
  const capture = liveCaptures.get(stepId);
  if (capture === undefined) return;
  if (capture.toolViews.length >= COORDINATOR_SNAPSHOT_MAX_CALL_VIEWS) {
    capture.toolViews.push({
      callId: callId ?? '',
      tool,
      params,
      preCallTodos: [],
      result: { overLimit: true },
    });
    return;
  }
  const preCallTodos = db
    .select()
    .from(todo)
    .where(eq(todo.teamId, teamId))
    .all()
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      phase: row.phase,
      archivedAt: row.archivedAt ?? null,
    }));
  capture.recordCount += preCallTodos.length;
  capture.toolViews.push({
    callId: callId ?? '',
    tool,
    params,
    preCallTodos,
    result,
  });
}

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

export function sealCoordinatorTurnSnapshot(
  db: Db,
  stepRow: StepRow,
  teamId: string,
  outcome: 'success' | 'failed' | 'stopped',
  capturedAt: number,
): void {
  const capture = takeTurnCapture(stepRow.id);
  const existing = db
    .select()
    .from(coordinatorTurnSnapshot)
    .where(eq(coordinatorTurnSnapshot.turnId, stepRow.id))
    .get();
  if (existing !== undefined) return;
  if (capture === undefined) return;
  const base = {
    turnId: stepRow.id,
    teamId,
    sourceTraceId: otlpTraceIdOfTurn(stepRow.id),
    schemaVersion: COORDINATOR_SNAPSHOT_SCHEMA_VERSION,
    outcome,
    capturedAt,
    expiresAt: capturedAt + 30 * 86_400_000,
  };
  try {
    if (capture.recordCount > COORDINATOR_SNAPSHOT_MAX_RECORDS)
      throw new Error('record limit exceeded');
    const parsed = snapshotPayload.parse({ toolViews: capture.toolViews });
    const redacted = redactSecrets(parsed);
    const payloadText = JSON.stringify(redacted.value);
    if (Buffer.byteLength(payloadText, 'utf8') > COORDINATOR_SNAPSHOT_PAYLOAD_MAX_BYTES)
      throw new Error('payload limit exceeded');
    db.insert(coordinatorTurnSnapshot)
      .values({
        ...base,
        status: 'sealed',
        reason: null,
        redactionCount: redacted.count,
        payloadBytes: Buffer.byteLength(payloadText, 'utf8'),
        digest: createHash('sha256')
          .update(canonical(JSON.parse(payloadText)))
          .digest('hex'),
        payload: payloadText,
      })
      .run();
  } catch {
    try {
      db.insert(coordinatorTurnSnapshot)
        .values({
          ...base,
          status: 'unusable',
          reason: 'capture bounds or serialization exceeded',
          redactionCount: 0,
          payloadBytes: 0,
          digest: null,
          payload: null,
        })
        .run();
    } catch {}
  }
}

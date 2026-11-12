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

export function isCaptureTool(name: string): name is CaptureTool {
  return (CAPTURE_TOOLS as readonly string[]).includes(name);
}

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

const claimView = z.object({
  systemPrompt: z.string(),
  instruction: z.string().nullable(),
  trigger: z.string(),
  memories: z.array(z.string()),
  provider: z.string(),
  modelId: z.string(),
  thinkingLevel: z.string().nullable(),
  volatileText: z.string().nullable(),
});

const snapshotPayload = z.object({
  claim: claimView.nullable(),
  toolViews: z.array(toolView),
});

interface OpenToolView {
  callId: string;
  tool: CaptureTool;
  params: Record<string, unknown>;
  preCallTodos: z.infer<typeof todoView>[];
}

interface TurnCaptureState {
  open: OpenToolView[];
  views: z.infer<typeof toolView>[];
  recordCount: number;
  overLimit: boolean;
  claim: z.infer<typeof claimView> | null;
}

const liveCaptures = new Map<string, TurnCaptureState>();

export function openTurnCapture(stepId: string): TurnCaptureState {
  const existing = liveCaptures.get(stepId);
  if (existing) return existing;
  const capture: TurnCaptureState = {
    open: [],
    views: [],
    recordCount: 0,
    overLimit: false,
    claim: null,
  };
  liveCaptures.set(stepId, capture);
  return capture;
}

export function existingTurnCapture(stepId: string): TurnCaptureState | undefined {
  return liveCaptures.get(stepId);
}

export function takeTurnCapture(stepId: string): TurnCaptureState | undefined {
  const capture = liveCaptures.get(stepId);
  liveCaptures.delete(stepId);
  return capture;
}

export function captureClaimInputs(stepId: string, claim: z.infer<typeof claimView>): void {
  const capture = existingTurnCapture(stepId);
  if (capture === undefined || capture.claim !== null) return;
  capture.claim = claimView.parse(claim);
}

export function capturePreCallWorld(
  db: Db,
  stepId: string,
  teamId: string,
  tool: CaptureTool,
  callId: string | undefined,
  params: Record<string, unknown>,
): void {
  const capture = existingTurnCapture(stepId);
  if (capture === undefined) return;
  if (capture.views.length + capture.open.length >= COORDINATOR_SNAPSHOT_MAX_CALL_VIEWS) {
    capture.overLimit = true;
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
  if (capture.recordCount + preCallTodos.length > COORDINATOR_SNAPSHOT_MAX_RECORDS) {
    capture.overLimit = true;
    return;
  }
  capture.recordCount += preCallTodos.length;
  capture.open.push({ callId: callId ?? '', tool, params, preCallTodos });
}

export function captureToolResult(stepId: string, tool: CaptureTool, result: unknown): void {
  const capture = existingTurnCapture(stepId);
  if (capture === undefined) return;
  const open = capture.open.pop();
  if (open === undefined || open.tool !== tool) {
    if (open !== undefined) capture.open.push(open);
    return;
  }
  capture.views.push({ ...open, result });
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
    if (capture.overLimit) throw new Error('capture view or record limit crossed');
    const parsed = snapshotPayload.parse({ claim: capture.claim, toolViews: capture.views });
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

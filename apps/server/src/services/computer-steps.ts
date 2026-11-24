import type { ComputerImage, ComputerStep, ComputerTool } from '@cairn/shared';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computerCall } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { userOfStep } from './computer-activity.js';

export const COMPUTER_STEP_LINGER_MS = 30_000;
const CALLS_SCANNED = 60;
const IN_FLIGHT: readonly string[] = ['dispatched', 'running'];

const SCREEN_TOOLS: readonly ComputerTool[] = [
  'computer_observe',
  'computer_act',
  'user_computer_observe',
  'user_computer_act',
];
const GUI_TOOLS: readonly ComputerTool[] = [
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'desktop_snapshot',
  'desktop_act',
  ...SCREEN_TOOLS,
];

type CallRow = Pick<
  typeof computerCall.$inferSelect,
  'id' | 'stepId' | 'machineId' | 'tool' | 'state' | 'createdAt' | 'startedAt' | 'finishedAt'
>;

function actions(params: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(params.actions)
    ? params.actions.filter(
        (action): action is Record<string, unknown> =>
          action !== null && typeof action === 'object' && !Array.isArray(action),
      )
    : [];
}

function surfaceOf(tool: ComputerTool): ComputerStep['surface'] {
  if (tool.startsWith('browser_')) return 'browser';
  return tool === 'computer_observe' || tool === 'computer_act' ? 'desktop' : 'app';
}

export function pngSize(image: ComputerImage): { width: number; height: number } | null {
  if (image.mimeType !== 'image/png') return null;
  const head = Buffer.from(image.data.slice(0, 44), 'base64');
  if (head.length < 24 || head.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function clickPoint(
  tool: ComputerTool,
  params: Record<string, unknown>,
  size: { width: number; height: number },
): { x: number; y: number } | null {
  if (tool !== 'computer_act') return null;
  const hit = actions(params).findLast(
    (action) =>
      (action.kind === 'click' || action.kind === 'double_click') &&
      typeof action.x === 'number' &&
      typeof action.y === 'number',
  );
  if (hit === undefined) return null;
  const x = hit.x as number;
  const y = hit.y as number;
  if (x < 0 || y < 0 || x > size.width || y > size.height) return null;
  return { x, y };
}

function latestShot(db: Db, teamId: string, call: CallRow): ComputerStep['shot'] {
  const rows = db
    .select({
      id: computerCall.id,
      tool: computerCall.tool,
      params: computerCall.params,
      resultImages: computerCall.resultImages,
    })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.teamId, teamId),
        eq(computerCall.stepId, call.stepId),
        eq(computerCall.machineId, call.machineId),
        inArray(computerCall.tool, [...SCREEN_TOOLS]),
        isNotNull(computerCall.resultImages),
      ),
    )
    .orderBy(desc(computerCall.createdAt), desc(computerCall.id))
    .limit(4)
    .all();
  for (const row of rows) {
    const image = row.resultImages?.[0];
    const size = image === undefined ? null : pngSize(image);
    if (size === null) continue;
    return { callId: row.id, ...size, point: clickPoint(row.tool, row.params, size) };
  }
  return null;
}

function lastScreenCallMissedShot(
  db: Db,
  teamId: string,
  call: CallRow,
  scanned: readonly CallRow[],
): boolean {
  const screen = scanned.find(
    (row) =>
      row.stepId === call.stepId &&
      row.machineId === call.machineId &&
      SCREEN_TOOLS.includes(row.tool) &&
      row.state === 'done',
  );
  if (screen === undefined) return false;
  const row = db
    .select({ resultImages: computerCall.resultImages })
    .from(computerCall)
    .where(and(eq(computerCall.teamId, teamId), eq(computerCall.id, screen.id)))
    .get();
  return (row?.resultImages ?? []).length === 0;
}

export function listComputerSteps(db: Db, teamId: string, userId: string): ComputerStep[] {
  const now = nowMs();
  const scanned: CallRow[] = db
    .select({
      id: computerCall.id,
      stepId: computerCall.stepId,
      machineId: computerCall.machineId,
      tool: computerCall.tool,
      state: computerCall.state,
      createdAt: computerCall.createdAt,
      startedAt: computerCall.startedAt,
      finishedAt: computerCall.finishedAt,
    })
    .from(computerCall)
    .where(and(eq(computerCall.teamId, teamId), inArray(computerCall.tool, [...GUI_TOOLS])))
    .orderBy(desc(computerCall.createdAt), desc(computerCall.id))
    .limit(CALLS_SCANNED)
    .all();
  const owned = new Map<string, boolean>();
  const ownedBy = (stepId: string) => {
    const known = owned.get(stepId);
    if (known !== undefined) return known;
    const mine = userOfStep(db, userId, stepId, true, now) !== null;
    owned.set(stepId, mine);
    return mine;
  };
  const steps: ComputerStep[] = [];
  const seen = new Set<string>();
  for (const call of scanned) {
    if (seen.has(call.machineId)) continue;
    seen.add(call.machineId);
    const inFlight = IN_FLIGHT.includes(call.state);
    const at = inFlight
      ? (call.startedAt ?? call.createdAt)
      : (call.finishedAt ?? call.startedAt ?? call.createdAt);
    if (!inFlight && now - at > COMPUTER_STEP_LINGER_MS) continue;
    if (!ownedBy(call.stepId)) continue;
    const shot = latestShot(db, teamId, call);
    steps.push({
      machineId: call.machineId,
      callId: call.id,
      surface: surfaceOf(call.tool),
      inFlight,
      at,
      shot,
      shotMissing: shot === null && lastScreenCallMissedShot(db, teamId, call, scanned),
    });
  }
  return steps;
}

export function computerStepShot(
  db: Db,
  teamId: string,
  userId: string,
  callId: string,
): ComputerImage | null {
  const row = db
    .select({
      stepId: computerCall.stepId,
      tool: computerCall.tool,
      resultImages: computerCall.resultImages,
    })
    .from(computerCall)
    .where(and(eq(computerCall.teamId, teamId), eq(computerCall.id, callId)))
    .get();
  if (row === undefined || !SCREEN_TOOLS.includes(row.tool)) return null;
  if (userOfStep(db, userId, row.stepId, false, nowMs()) === null) return null;
  return row.resultImages?.[0] ?? null;
}

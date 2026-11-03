import {
  type ComputerCallState,
  type ComputerFrame,
  type MachineComputerFramesResponse,
  redactSecrets,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computerCall } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';

export const COMPUTER_OUTPUT_HEAD_CHARS = 16 * 1024;
export const COMPUTER_OUTPUT_TAIL_CHARS = 48 * 1024;

export const COMPUTER_OUTPUT_PENDING_CHARS = 64 * 1024;

const pendingOutput = new Map<string, string>();

export function hasPendingComputerOutput(callId: string): boolean {
  return pendingOutput.has(callId);
}

export function pendingComputerOutputRelease(db: Db, machineId: string): () => void {
  const ids = db
    .select({ id: computerCall.id })
    .from(computerCall)
    .where(eq(computerCall.machineId, machineId))
    .all()
    .map(({ id }) => id);
  return () => {
    for (const id of ids) pendingOutput.delete(id);
  };
}

const FINISHED_STATES: ReadonlySet<ComputerCallState> = new Set(['done', 'error', 'interrupted']);

type CallRow = typeof computerCall.$inferSelect;
type CallPatch = Partial<typeof computerCall.$inferInsert>;

function redact(text: string): string {
  return redactSecrets(text).value as string;
}

type Output = Pick<CallRow, 'outputHead' | 'outputTail' | 'outputChars'> & { pending: string };

function appendOutput(out: Output, text: string, flush: boolean): Output {
  const raw = out.pending + text;
  let start = raw.length;
  while (start > 0 && !/\s/.test(raw[start - 1] ?? '')) start--;
  const keep = !flush && raw.length - start <= COMPUTER_OUTPUT_PENDING_CHARS;
  const pending = keep ? raw.slice(start) : '';
  const settled = keep ? raw.slice(0, start) : raw;
  const joined =
    settled === ''
      ? out.outputHead + out.outputTail
      : redact(out.outputHead + out.outputTail + settled);
  return {
    outputHead: joined.slice(0, COMPUTER_OUTPUT_HEAD_CHARS),
    outputTail: joined.slice(COMPUTER_OUTPUT_HEAD_CHARS).slice(-COMPUTER_OUTPUT_TAIL_CHARS),
    outputChars: out.outputChars + text.length,
    pending,
  };
}

function applyFrames(
  row: CallRow,
  frames: readonly ComputerFrame[],
  now: number,
): { patch: CallPatch; pending: string } {
  let expected = row.lastSeq + 1;
  let finished = false;
  let output: Output = {
    outputHead: row.outputHead,
    outputTail: row.outputTail,
    outputChars: row.outputChars,
    pending: pendingOutput.get(row.id) ?? '',
  };
  const patch: CallPatch = {};
  for (const frame of frames) {
    if (frame.seq !== expected) {
      throw new HttpError(409, `computer frame ${frame.seq} arrived before frame ${expected}`);
    }
    if (finished) throw new HttpError(409, 'computer frame after the call finished');
    expected++;
    switch (frame.kind) {
      case 'output':
        output = appendOutput(output, frame.text, false);
        break;
      case 'heartbeat':
        break;
      case 'done':
        finished = true;
        output = appendOutput(output, '', true);
        Object.assign(patch, {
          resultText: redact(frame.text),
          resultImages: frame.images ?? null,
          exitCode: frame.exitCode ?? null,
          finishedAt: now,
          ...(row.state === 'cancelled' ? {} : { state: 'done' as const }),
        });
        break;
      case 'error':
        finished = true;
        output = appendOutput(output, '', true);
        Object.assign(patch, {
          errorMessage: redact(frame.message),
          errorDelivery: frame.delivery,
          finishedAt: now,
          ...(row.state === 'cancelled' ? {} : { state: 'error' as const }),
        });
        break;
    }
  }
  const { pending, ...stored } = output;
  return {
    pending,
    patch: {
      ...stored,
      ...patch,
      lastSeq: expected - 1,
      ...(row.startedAt === null ? { startedAt: now } : {}),
      ...(row.state === 'dispatched' && patch.state === undefined
        ? { state: 'running' as const }
        : {}),
    },
  };
}

export function receiveComputerFrames(
  db: Db,
  machineId: string,
  callId: string,
  frames: readonly ComputerFrame[],
): MachineComputerFramesResponse {
  const result = db.transaction((tx) => {
    const row = tx.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (!row || row.machineId !== machineId) throw new HttpError(404, 'computer call not found');
    const ordered = [...frames].sort((a, b) => a.seq - b.seq);
    if (new Set(ordered.map((f) => f.seq)).size !== ordered.length) {
      throw new HttpError(400, 'computer frames repeat a sequence number');
    }
    const fresh = ordered.filter((f) => f.seq > row.lastSeq);
    const cancelled = row.state === 'cancelled';
    if (fresh.length === 0) return { response: { ok: true as const, cancelled }, pending: null };
    if (FINISHED_STATES.has(row.state) || (cancelled && row.finishedAt !== null)) {
      throw new HttpError(409, `computer call already ${row.state}`);
    }
    const { patch, pending } = applyFrames(row, fresh, nowMs());
    tx.update(computerCall).set(patch).where(eq(computerCall.id, callId)).run();
    return { response: { ok: true as const, cancelled }, pending };
  });
  if (result.pending === '') pendingOutput.delete(callId);
  else if (result.pending !== null) pendingOutput.set(callId, result.pending);
  return result.response;
}

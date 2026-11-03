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

const REDACTED_MARK = '[REDACTED]';
const CREDENTIAL_CONTINUATION = /^[A-Za-z0-9._~+/=-]+/;

const FINISHED_STATES: ReadonlySet<ComputerCallState> = new Set(['done', 'error', 'interrupted']);

type CallRow = typeof computerCall.$inferSelect;
type CallPatch = Partial<typeof computerCall.$inferInsert>;

function redact(text: string): string {
  return redactSecrets(text).value as string;
}

function appendOutput(
  out: Pick<CallRow, 'outputHead' | 'outputTail' | 'outputChars'>,
  text: string,
): Pick<CallRow, 'outputHead' | 'outputTail' | 'outputChars'> {
  const stored = out.outputHead + out.outputTail;
  const continued = stored.endsWith(REDACTED_MARK)
    ? text.replace(CREDENTIAL_CONTINUATION, '')
    : text;
  const joined = redact(stored + continued);
  return {
    outputHead: joined.slice(0, COMPUTER_OUTPUT_HEAD_CHARS),
    outputTail: joined.slice(COMPUTER_OUTPUT_HEAD_CHARS).slice(-COMPUTER_OUTPUT_TAIL_CHARS),
    outputChars: out.outputChars + text.length,
  };
}

function applyFrames(row: CallRow, frames: readonly ComputerFrame[], now: number): CallPatch {
  let expected = row.lastSeq + 1;
  let finished = false;
  let output = {
    outputHead: row.outputHead,
    outputTail: row.outputTail,
    outputChars: row.outputChars,
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
        output = appendOutput(output, frame.text);
        break;
      case 'heartbeat':
        break;
      case 'done':
        finished = true;
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
        Object.assign(patch, {
          errorMessage: redact(frame.message),
          errorDelivery: frame.delivery,
          finishedAt: now,
          ...(row.state === 'cancelled' ? {} : { state: 'error' as const }),
        });
        break;
    }
  }
  return {
    ...output,
    ...patch,
    lastSeq: expected - 1,
    ...(row.startedAt === null ? { startedAt: now } : {}),
    ...(row.state === 'dispatched' && patch.state === undefined
      ? { state: 'running' as const }
      : {}),
  };
}

export function receiveComputerFrames(
  db: Db,
  machineId: string,
  callId: string,
  frames: readonly ComputerFrame[],
): MachineComputerFramesResponse {
  return db.transaction((tx) => {
    const row = tx.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (!row || row.machineId !== machineId) throw new HttpError(404, 'computer call not found');
    const ordered = [...frames].sort((a, b) => a.seq - b.seq);
    if (new Set(ordered.map((f) => f.seq)).size !== ordered.length) {
      throw new HttpError(400, 'computer frames repeat a sequence number');
    }
    const fresh = ordered.filter((f) => f.seq > row.lastSeq);
    const cancelled = row.state === 'cancelled';
    if (fresh.length === 0) return { ok: true as const, cancelled };
    if (FINISHED_STATES.has(row.state) || (cancelled && row.finishedAt !== null)) {
      throw new HttpError(409, `computer call already ${row.state}`);
    }
    tx.update(computerCall)
      .set(applyFrames(row, fresh, nowMs()))
      .where(eq(computerCall.id, callId))
      .run();
    return { ok: true as const, cancelled };
  });
}

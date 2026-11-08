import { ANSWERS_ACK_VERSION, type MachineCapabilities } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

type MachineRow = typeof machine.$inferSelect;

export function acksAnswers(row: Pick<MachineRow, 'capabilities'> | undefined): boolean {
  return (row?.capabilities?.answersAck ?? 0) >= ANSWERS_ACK_VERSION;
}

export function machineAcksAnswers(db: Db, machineId: string): boolean {
  return acksAnswers(db.select().from(machine).where(eq(machine.id, machineId)).get());
}

export function declareAnswersAck(db: Db, machineId: string, version: number | undefined): void {
  const row = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (row === undefined) return;
  const current: MachineCapabilities = row.capabilities ?? { mcpServers: [], skills: [] };
  const { answersAck: previous, ...rest } = current;
  if (row.capabilities !== null && previous === version) return;
  const next: MachineCapabilities = version === undefined ? rest : { ...rest, answersAck: version };
  db.update(machine).set({ capabilities: next }).where(eq(machine.id, machineId)).run();
}

export function outdatedAnswerReceiver(db: Db, buildId: string): MachineRow | null {
  const running = db
    .select({ machineId: step.machineId })
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.status, 'claimed')))
    .all()
    .at(-1);
  if (running === undefined) return null;
  const row =
    running.machineId === null
      ? undefined
      : db.select().from(machine).where(eq(machine.id, running.machineId)).get();
  return acksAnswers(row) ? null : (row ?? null);
}

export function assertAnswerReceiver(db: Db, buildId: string): void {
  const outdated = outdatedAnswerReceiver(db, buildId);
  if (outdated === null) return;
  throw new HttpError(
    409,
    `machine "${outdated.name}" needs a cairn update before it can receive answers; the question stays pending until it is updated`,
  );
}

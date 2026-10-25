import type { StepQueueBlocked, StepQueueInfo } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, build, chief, chiefThread, machine, step, todo } from '../db/schema.js';
import {
  agentForStep,
  agentIdForStep,
  missingCapabilities,
  runtimeGatePasses,
} from './dispatch-eligibility.js';

export interface QueueTargetStep {
  id: string;
  createdAt: number;
  homeMachineId: string | null;
  holdReason?: string | null;
  holdUntil?: number | null;
}

export function stepQueueProjector(db: Db, teamId: string) {
  const workerRows = db
    .select({
      id: step.id,
      createdAt: step.createdAt,
      kind: step.kind,
      prompt: step.prompt,
      fallback: step.fallback,
      todoRow: todo,
    })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), eq(todo.teamId, teamId)))
    .all();
  const workerQueue = workerRows.map((r) => ({
    ...r,
    home: agentForStep(db, r.todoRow, r.kind, r.prompt)?.machineId ?? null,
  }));
  const chiefRows = db
    .select({
      id: step.id,
      createdAt: step.createdAt,
      threadId: step.buildId,
      home: agent.machineId,
      holdReason: step.holdReason,
      holdUntil: step.holdUntil,
      chiefId: chiefThread.chiefId,
    })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .innerJoin(agent, eq(chief.agentId, agent.id))
    .where(and(eq(step.status, 'pending'), eq(step.kind, 'chief'), eq(chiefThread.teamId, teamId)))
    .all();
  const queue = [...workerQueue, ...chiefRows].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );

  const claimedCountCache = new Map<string, number>();
  const claimedCount = (machineId: string): number => {
    const hit = claimedCountCache.get(machineId);
    if (hit !== undefined) return hit;
    const n = db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
      .all().length;
    claimedCountCache.set(machineId, n);
    return n;
  };
  const machineCache = new Map<string, typeof machine.$inferSelect | undefined>();
  const machineRowOf = (machineId: string) => {
    if (!machineCache.has(machineId)) {
      machineCache.set(machineId, db.select().from(machine).where(eq(machine.id, machineId)).get());
    }
    return machineCache.get(machineId);
  };

  const teamMachines = db.select().from(machine).where(eq(machine.teamId, teamId)).all();
  const agentCache = new Map<string, typeof agent.$inferSelect | null>();
  const agentRowOf = (agentId: string | null): typeof agent.$inferSelect | null => {
    if (agentId === null) return null;
    if (!agentCache.has(agentId)) {
      agentCache.set(agentId, db.select().from(agent).where(eq(agent.id, agentId)).get() ?? null);
    }
    return agentCache.get(agentId) ?? null;
  };

  function agentForRow(row: (typeof queue)[number]): typeof agent.$inferSelect | null {
    if ('todoRow' in row) {
      return agentRowOf(agentIdForStep(row.todoRow, row.kind, row.prompt));
    }
    const chiefRow = db.select().from(chief).where(eq(chief.id, row.chiefId)).get();
    return agentRowOf(chiefRow?.agentId ?? null);
  }

  function blockedFor(
    target: QueueTargetStep,
    row: (typeof queue)[number],
  ): StepQueueBlocked | undefined {
    if (target.homeMachineId === null) {
      return { kind: 'machine-offline', missing: [] };
    }
    const home = teamMachines.find((m) => m.id === target.homeMachineId);
    if (home === undefined || !home.online) {
      return { kind: 'machine-offline', missing: [] };
    }
    const agentRow = agentForRow(row);
    const provider =
      ('fallback' in row ? row.fallback?.model?.provider : undefined) ?? agentRow?.provider;
    if (agentRow?.modelId != null && runtimeGatePasses(home, provider)) {
      const missing = missingCapabilities(home, agentRow);
      if (missing.length > 0) return { kind: 'capability-missing', missing };
    }
    return undefined;
  }

  function project(target: QueueTargetStep): StepQueueInfo | null {
    const queueRow = queue.find((r) => r.id === target.id);
    if (queueRow === undefined) return null;
    const pool = queue.filter((r) => r.home === target.homeMachineId);
    const position = pool.findIndex((r) => r.id === target.id) + 1;
    if (position === 0) return null;
    let waitingFor: StepQueueInfo['waitingFor'] = null;
    if (target.homeMachineId !== null) {
      const row = machineRowOf(target.homeMachineId);
      if (row !== undefined) {
        waitingFor = {
          machineId: row.id,
          name: row.name,
          running: claimedCount(row.id),
          capacity: row.maxConcurrent,
        };
      }
    }
    const hold: StepQueueInfo['hold'] =
      target.holdReason === 'quota' && target.holdUntil != null
        ? { reason: 'quota', retryAt: target.holdUntil }
        : undefined;
    const blocked = blockedFor(target, queueRow);
    return {
      position,
      waitingFor,
      ...(hold !== undefined ? { hold } : {}),
      ...(blocked !== undefined ? { blocked } : {}),
    };
  }

  function pendingChiefOf(threadId: string): QueueTargetStep | null {
    const rows = chiefRows.filter((r) => r.threadId === threadId);
    const last = rows[rows.length - 1];
    if (last === undefined) return null;
    return {
      id: last.id,
      createdAt: last.createdAt,
      homeMachineId: last.home,
      holdReason: last.holdReason,
      holdUntil: last.holdUntil,
    };
  }

  return { project, pendingChiefOf };
}

import type { MachineShellPrecheckBody, MachineShellResultBody } from '@cairn/shared';
import { AGENT_TOOL_SHELL } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, machine, shellCommand, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { NotFoundError } from './builds.js';
import { agentForStep, isChiefConversation, type MachineDeps, ownedStep } from './machines.js';

export function precheckShellCommand(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  body: MachineShellPrecheckBody,
): { allowed: true; runId: string } {
  const { db } = deps;
  const stepRow = ownedStep(deps, machineId, stepId);
  if (stepRow.status !== 'claimed') {
    throw new HttpError(409, `step ${stepId} is not in flight (status: ${stepRow.status})`);
  }
  if (stepRow.kind === 'chief' || isChiefConversation(stepRow.buildId)) {
    throw new HttpError(409, `step ${stepId} is a chief step (no shell semantics)`);
  }
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const agentRow = todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : undefined;
  if (!todoRow || !agentRow) {
    throw new HttpError(409, `step ${stepId} has no resolvable agent for shell gating`);
  }
  const machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow) throw new NotFoundError(`machine ${machineId}`);
  const deny = (reason: string): never => {
    db.insert(shellCommand)
      .values({
        id: newRecordId(),
        stepId,
        machineId,
        agentId: agentRow.id,
        teamId: machineRow.teamId,
        command: body.command,
        status: 'denied',
        errorMessage: reason,
        createdAt: nowMs(),
        finishedAt: nowMs(),
      })
      .run();
    throw new HttpError(403, reason);
  };
  if (!agentRow.tools.includes(AGENT_TOOL_SHELL)) {
    deny(
      `Agent ${agentRow.displayName} 未获「远程 shell」授权（Agent 详情页权限 tab），无法执行命令`,
    );
  }
  if (!machineRow.shellEnabled) {
    deny(`机器 ${machineRow.name} 未开启 shell 访问（机器详情页），无法执行命令`);
  }
  const runId = newRecordId();
  db.insert(shellCommand)
    .values({
      id: runId,
      stepId,
      machineId,
      agentId: agentRow.id,
      teamId: machineRow.teamId,
      command: body.command,
      status: 'running',
      createdAt: nowMs(),
    })
    .run();
  return { allowed: true as const, runId };
}

export function reportShellResult(
  deps: MachineDeps,
  machineId: string,
  runId: string,
  body: MachineShellResultBody,
): void {
  const { db } = deps;
  const row = db.select().from(shellCommand).where(eq(shellCommand.id, runId)).get();
  if (!row) throw new HttpError(404, `shell run ${runId} not found`);
  if (row.machineId !== machineId) {
    throw new HttpError(403, `shell run ${runId} not owned by machine ${machineId}`);
  }
  if (row.status === 'denied') {
    throw new HttpError(409, `shell run ${runId} was denied (no result to report)`);
  }
  if (row.status === 'done' || row.status === 'failed') return;
  db.update(shellCommand)
    .set({
      status: body.status,
      exitCode: body.status === 'done' ? (body.exitCode ?? null) : null,
      output: body.output ?? null,
      ...(body.status === 'failed' && body.errorMessage !== undefined
        ? { errorMessage: body.errorMessage }
        : {}),
      finishedAt: nowMs(),
    })
    .where(eq(shellCommand.id, runId))
    .run();
}

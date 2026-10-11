// 机器面远程 shell（#1134 自 machines.ts 纯提取，行为零变化；XMON-108 R1：
// 每调用预检 + 审计先落 + 终态一次回写）。own 表（shell_command）+ own 测试
// 面（test/machine-shell.test.ts）自持；所有权校验与 Agent 解析复用
// machines.ts journal 内核（ownedStep / agentForStep）。路由面 =
// routes-machine.ts 的 shell / shell-result 端点。

import type { MachineShellPrecheckBody, MachineShellResultBody } from '@pacman/shared';
import { AGENT_TOOL_SHELL } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { build, machine, shellCommand, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { NotFoundError } from './builds.js';
import { agentForStep, isChiefConversation, type MachineDeps, ownedStep } from './machines.js';

// —— machine shell（XMON-108 R1：每调用预检 + 审计先落 + 终态一次回写）——————

/** 预检（POST /api/machine/shell/{stepId}）：claim 期 localTools 只是注册面，
 * 每条命令的真实闸在这里。双闸每调用重读——agent「远程 shell」开关（agent 行
 * 现值，步中被摘同样立即拒）∩ machine.shellEnabled（机器行现值，验收 #3 的
 * 「秒级热加载」由此兑现，claim 时快照不作数）。审计先于放行落库：拒绝 =
 * denied 行（含拒绝原因）落库后 403；放行 = running 行落库后返回 runId，
 * daemon 执行完毕经 result 端点回写终态（执行侧唯一标识 = runId，与 stepId
 * 解耦——同步多条命令各领各的 runId）。403 措辞先例 = requestMerge
 * （builds.ts）双开关校验。 */
export function precheckShellCommand(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  body: MachineShellPrecheckBody,
): { allowed: true; runId: string } {
  const { db } = deps;
  const stepRow = ownedStep(deps, machineId, stepId);
  // 只对在跑步预检（pending 未领 / done/failed 已收尾 = 409 协议错）。
  if (stepRow.status !== 'claimed') {
    throw new HttpError(409, `step ${stepId} is not in flight (status: ${stepRow.status})`);
  }
  // chief 步无 shell 语义（claim 也不携带 localTools——见 buildChiefClaim）。
  if (stepRow.kind === 'chief' || isChiefConversation(stepRow.buildId)) {
    throw new HttpError(409, `step ${stepId} is a chief step (no shell semantics)`);
  }
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const agentRow = todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : undefined;
  // claim 门槛已保证 worker 步有可解 Agent（modelId 非空才可领）；此处不可
  // 解 = 协议层破坏（409，不落审计行——审计只记授权决定，见 schema 注释）。
  if (!todoRow || !agentRow) {
    throw new HttpError(409, `step ${stepId} has no resolvable agent for shell gating`);
  }
  const machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow) throw new NotFoundError(`machine ${machineId}`);
  // 拒绝路径：denied 审计行（终态，插入即终局）先落库，再抛 403 带原因——
  // 「未授权命令从未跑过」是审计事实本身。
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
  // 放行路径：running 审计行先于 runId 下发落库（命令将执行的事实先入账）。
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

/** 终态回写（POST /api/machine/shell/{runId}/result）：daemon 执行完毕按
 * runId 回写。状态机 = running → done | failed，终态只写一次——已终态行
 * 收到重复回写 = 幂等 200 不改写（branch-sync transitionBranchSync 同律：
 * 网络重试不产生第二份终账）。done = 进程跑完（exitCode 任意值含非零）；
 * failed = 执行没跑完（超时/杀进程/异常，errorMessage 携因）。denied 行收到
 * 回写 = 409（denied 的 runId 从未下发，只可能协议错）。 */
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
  if (row.status === 'done' || row.status === 'failed') return; // 终态幂等不改写
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

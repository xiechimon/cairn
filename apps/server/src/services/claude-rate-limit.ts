import type {
  ClaudeRateBlock,
  ClaudeRateLimitReport,
  ClaudeRateLimitWindow,
  MachineDoneBody,
} from '@cairn/shared';
import {
  applyClaudeRateLimit,
  CLAUDE_SUBSCRIPTION_PROVIDER_ID,
  claudeRateBlock,
  claudeRateProbeAt,
} from '@cairn/shared';
import { and, eq, or } from 'drizzle-orm';
import {
  build,
  chiefThread,
  claudeSubscription,
  machine,
  type QuotaWaitRow,
  step,
  todo,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { holdBlockedBuild } from './blockers.js';
import { accountHeld } from './claude-account-hold.js';
import { enabledSubscriptionId } from './claude-subscriptions.js';
import { enabledDevinSubscriptionId } from './devin-subscriptions.js';
import { capabilityGatePasses, runtimeGatePasses, stepRuntimeFor } from './dispatch-eligibility.js';
import { isChiefConversation, type MachineDeps, stepTeamId } from './machine-deps.js';
import {
  platformFallbackMachineId,
  priorSessionOf,
  routeTargets,
  teamDefaultMachineId,
} from './machine-routing.js';
import { effectiveModel } from './model-fallback.js';
import { notifyQuotaWait } from './notifications.js';
import { publishStepRow } from './quota-wait.js';
import { coordinatorProfile, profileForStep, type RouteProfile } from './routing-rules.js';
import { getTodo } from './todos.js';

type StepRow = typeof step.$inferSelect;
type AgentRow = RouteProfile;

function usesClaudeCode(
  agentRow: Pick<AgentRow, 'provider' | 'modelId'>,
  stepRow: Pick<StepRow, 'fallback'>,
): boolean {
  return stepRuntimeFor(effectiveModel(agentRow, stepRow).provider) === 'claude-code';
}

function claudeQuotaRow(
  prev: QuotaWaitRow | null,
  block: ClaudeRateBlock,
  now: number,
  reason?: string,
): QuotaWaitRow {
  const same = prev?.source === 'claude_rate_limit';
  return {
    kind: 'quota',
    providerId: CLAUDE_SUBSCRIPTION_PROVIDER_ID,
    label: block.subscription,
    reason: (reason ?? `Claude subscription ${block.subscription} rejected`).slice(0, 500),
    retryAfterMs: block.until !== null ? Math.max(1, block.until - now) : null,
    firstSeenAt: same ? prev.firstSeenAt : now,
    lastAt: now,
    attempts: same ? prev.attempts : 1,
    probeAt: claudeRateProbeAt(block, now),
    source: 'claude_rate_limit',
  };
}

function writeClaudeQuota(
  deps: MachineDeps,
  stepId: string,
  todoId: string | null,
  next:
    | { status: 'pending'; quotaBlock: null }
    | { status: 'waiting_quota'; quotaBlock: QuotaWaitRow },
): boolean {
  const res = deps.db
    .update(step)
    .set({
      status: next.status,
      machineId: null,
      quotaBlock: next.quotaBlock,
      holdReason: null,
      holdUntil: null,
    })
    .where(
      and(
        eq(step.id, stepId),
        next.status === 'waiting_quota'
          ? or(eq(step.status, 'pending'), eq(step.status, 'waiting_quota'))
          : eq(step.status, 'waiting_quota'),
      ),
    )
    .run();
  if (res.changes === 0) return false;
  if (todoId !== null) {
    const changed = deps.db
      .select({ buildId: step.buildId })
      .from(step)
      .where(eq(step.id, stepId))
      .get();
    if (changed !== undefined) holdBlockedBuild(deps.db, changed.buildId);
  }
  const fresh = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (fresh !== undefined) publishStepRow(deps, fresh);
  if (todoId !== null) {
    const record = getTodo(deps, todoId);
    if (record) deps.hub.publishTodoDoc(record.teamId, record);
  }
  return true;
}

export function refreshClaudeRateParks(deps: MachineDeps, teamId: string): void {
  const now = nowMs();
  const machines = deps.db.select().from(machine).where(eq(machine.teamId, teamId)).all();
  const byId = new Map(machines.map((row) => [row.id, row]));
  let changed = false;
  const defaultMachineId = teamDefaultMachineId(deps.db, teamId);
  const enabledId = enabledSubscriptionId(deps, teamId);
  const enabledDevinId = enabledDevinSubscriptionId(deps, teamId);
  const consider = (
    stepRow: StepRow,
    agentRow: AgentRow,
    todoRow: typeof todo.$inferSelect | null,
    buildRow: Pick<typeof build.$inferSelect, 'prevPhase' | 'withPlan' | 'planDocId'> | null,
  ) => {
    const prior =
      buildRow === null
        ? {
            priorSessionId: null,
            priorMachineId: null,
            priorSubscriptionId: null,
            freshSession: true,
          }
        : priorSessionOf(deps.db, stepRow, buildRow, {
            claude: enabledId,
            devin: enabledDevinId,
          });
    const sessionId =
      !prior.freshSession && prior.priorSessionId !== null ? prior.priorMachineId : null;
    const namedId = routeTargets(sessionId, agentRow.machineId)[0]?.machineId ?? null;
    const homeId =
      namedId ??
      platformFallbackMachineId(
        deps.db,
        machines,
        defaultMachineId,
        agentRow.requiredCapabilities?.os,
      );
    const owner = homeId ? byId.get(homeId) : undefined;
    const ownerBlock = owner ? claudeRateBlock(owner.claudeRateLimits ?? [], now) : null;
    if (
      stepRow.status === 'waiting_quota' &&
      stepRow.quotaBlock?.source === 'subscription_policy'
    ) {
      if (
        writeClaudeQuota(deps, stepRow.id, todoRow?.id ?? null, {
          status: 'pending',
          quotaBlock: null,
        })
      )
        changed = true;
      stepRow = { ...stepRow, status: 'pending', quotaBlock: null };
    }
    if (!usesClaudeCode(agentRow, stepRow)) return;
    if (stepRow.status === 'waiting_quota' && stepRow.quotaBlock?.source !== 'claude_rate_limit') {
      return;
    }
    if (stepRow.status !== 'pending' && stepRow.status !== 'waiting_quota') return;
    if (buildRow !== null && accountHeld(stepRow, prior, enabledId)) return;
    const runnable =
      owner?.online === true &&
      runtimeGatePasses(owner, 'claude-code') &&
      capabilityGatePasses(owner, agentRow) &&
      claudeRateBlock(owner.claudeRateLimits ?? [], now) === null;
    const todoId = todoRow?.id ?? null;
    if (ownerBlock && !runnable) {
      const first = stepRow.quotaBlock?.source !== 'claude_rate_limit';
      const quota = claudeQuotaRow(stepRow.quotaBlock, ownerBlock, now);
      const wrote = writeClaudeQuota(deps, stepRow.id, todoId, {
        status: 'waiting_quota',
        quotaBlock: quota,
      });
      if (!wrote) return;
      changed = true;
      if (first && todoRow) notifyQuotaWait(deps, todoRow, quota);
      return;
    }
    if (stepRow.status === 'waiting_quota') {
      if (writeClaudeQuota(deps, stepRow.id, todoId, { status: 'pending', quotaBlock: null })) {
        changed = true;
      }
    }
  };
  const workers = deps.db
    .select({ step, todo, build })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        eq(todo.teamId, teamId),
        or(eq(step.status, 'pending'), eq(step.status, 'waiting_quota')),
      ),
    )
    .all();
  for (const row of workers) {
    const agentRow = profileForStep(deps.db, row.todo, row.step.kind, row.step.id);
    if (agentRow) consider(row.step, agentRow, row.todo, row.build);
  }
  const chiefs = deps.db
    .select({ step, projectId: chiefThread.projectId })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(chiefThread.teamId, teamId),
        eq(step.kind, 'chief'),
        or(eq(step.status, 'pending'), eq(step.status, 'waiting_quota')),
      ),
    )
    .all();
  for (const row of chiefs) {
    const coordinator = coordinatorProfile(deps.db, teamId, row.projectId);
    if (coordinator !== null) consider(row.step, coordinator, null, null);
  }
  if (changed) deps.machineHub.wake(teamId);
}

export function recordClaudeRateLimit(
  deps: MachineDeps,
  machineRow: { id: string; teamId: string; claudeRateLimits: ClaudeRateLimitWindow[] | null },
  body: ClaudeRateLimitReport,
): void {
  const now = nowMs();
  const windows = applyClaudeRateLimit(machineRow.claudeRateLimits ?? [], body, now);
  deps.db
    .update(machine)
    .set({ claudeRateLimits: windows })
    .where(eq(machine.id, machineRow.id))
    .run();
  attributeQuotaWindows(deps, machineRow, body, now);
  refreshClaudeRateParks(deps, machineRow.teamId);
}

function attributeQuotaWindows(
  deps: MachineDeps,
  machineRow: { id: string; teamId: string },
  body: ClaudeRateLimitReport,
  now: number,
): void {
  if (body.stepId === undefined) return;
  const stepRow = deps.db
    .select({ machineId: step.machineId, claudeSubscriptionId: step.claudeSubscriptionId })
    .from(step)
    .where(eq(step.id, body.stepId))
    .get();
  if (stepRow?.machineId !== machineRow.id || stepRow.claudeSubscriptionId === null) return;
  const subscriptionId = stepRow.claudeSubscriptionId;
  const current = deps.db
    .select({ quotaWindows: claudeSubscription.quotaWindows })
    .from(claudeSubscription)
    .where(
      and(
        eq(claudeSubscription.id, subscriptionId),
        eq(claudeSubscription.teamId, machineRow.teamId),
      ),
    )
    .get();
  if (current === undefined) return;
  deps.db
    .update(claudeSubscription)
    .set({ quotaWindows: applyClaudeRateLimit(current.quotaWindows ?? [], body, now) })
    .where(eq(claudeSubscription.id, subscriptionId))
    .run();
}

function handBackClaimed(deps: MachineDeps, stepId: string): boolean {
  return (
    deps.db
      .update(step)
      .set({ status: 'pending', machineId: null, holdReason: null, holdUntil: null })
      .where(and(eq(step.id, stepId), eq(step.status, 'claimed')))
      .run().changes > 0
  );
}

export function recoverClaudeRateLimitFailure(
  deps: MachineDeps,
  stepRow: StepRow,
  outcome: MachineDoneBody,
): boolean {
  if (outcome.status !== 'failed') return false;
  const now = nowMs();
  const machineRow = stepRow.machineId
    ? deps.db.select().from(machine).where(eq(machine.id, stepRow.machineId)).get()
    : undefined;
  const block = claudeRateBlock(machineRow?.claudeRateLimits ?? [], now);
  let agentPick: Pick<AgentRow, 'provider' | 'modelId'> | null = null;
  if (isChiefConversation(stepRow.buildId)) {
    const thread = deps.db
      .select({ teamId: chiefThread.teamId, projectId: chiefThread.projectId })
      .from(chiefThread)
      .where(eq(chiefThread.id, stepRow.buildId))
      .get();
    agentPick = thread ? coordinatorProfile(deps.db, thread.teamId, thread.projectId) : null;
  } else {
    const linked = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    const todoRow = linked
      ? deps.db.select().from(todo).where(eq(todo.id, linked.todoId)).get()
      : undefined;
    agentPick = todoRow ? profileForStep(deps.db, todoRow, stepRow.kind, stepRow.id) : null;
  }
  const claude = agentPick !== null && usesClaudeCode(agentPick, stepRow);
  const teamId = stepTeamId(deps, stepRow);
  if (block && claude) {
    if (!handBackClaimed(deps, stepRow.id)) return false;
    if (teamId) {
      refreshClaudeRateParks(deps, teamId);
      deps.machineHub.wake(teamId);
    }
    return true;
  }
  if (outcome.quotaBlock?.providerId !== CLAUDE_SUBSCRIPTION_PROVIDER_ID) return false;
  if (!handBackClaimed(deps, stepRow.id)) return false;
  const retry = outcome.quotaBlock.retryAfterMs ?? null;
  const synthetic: ClaudeRateBlock = {
    until: retry !== null ? now + retry : null,
    subscription: outcome.quotaBlock.label ?? CLAUDE_SUBSCRIPTION_PROVIDER_ID,
  };
  const quota = claudeQuotaRow(stepRow.quotaBlock, synthetic, now, outcome.quotaBlock.reason);
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const wrote = writeClaudeQuota(deps, stepRow.id, buildRow?.todoId ?? null, {
    status: 'waiting_quota',
    quotaBlock: quota,
  });
  if (wrote && stepRow.quotaBlock?.source !== 'claude_rate_limit' && buildRow) {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow) notifyQuotaWait(deps, todoRow, quota);
  }
  if (teamId) deps.machineHub.wake(teamId);
  return wrote;
}

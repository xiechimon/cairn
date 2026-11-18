import type { MachineDoneBody, ModelUsage, OtelObservation } from '@cairn/shared';
import {
  ACTIVE_STEP_STATUSES,
  CHIEF_TURN_ERROR_KIND,
  formatSkillRouteSection,
  stripTurnContext,
  suggestSkillsForMessage,
} from '@cairn/shared';
import { and, asc, desc, eq, inArray, isNotNull, notInArray, notLike, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  chiefThread,
  chiefTurnUsage,
  claudeSubscription,
  coordinatorInput,
  devinSubscription,
  provider,
  step,
  stepUsage,
  tokenUsage,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { emitRuntimeStepSpan } from '../runtime-otel.js';
import {
  chiefClaimContext,
  finishChiefTurn,
  notifyChiefTurn,
  parseChiefTrigger,
  recoverGateWake,
} from './chief.js';
import { cancelPendingQuestions } from './chief-questions.js';
import { QUEUED_HOLD, recordChiefStop, steeredMessageScopes } from './chief-turns.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { openTurnCapture, sealCoordinatorTurnSnapshot } from './coordinator-turn-capture.js';
import { imTurnFinished } from './im/runtime.js';
import {
  isChiefConversation,
  type MachineDeps,
  publishStepStatus,
  stepTeamId,
  upsertChiefRow,
} from './machine-deps.js';
import { injectMemoryDocuments } from './memory.js';
import { settleMemoryEditTurn } from './memory-edit-turns.js';
import { recallMemorySection } from './memory-recall.js';
import { stepScopeProjectId } from './picked-project.js';
import { projectTurnContextTraced } from './project-instructions.js';
import { coordinatorProfile } from './routing-rules.js';
import { scanLocalSkills } from './skills.js';
import { costFromRates, ratesForModel } from './token-usage-cost.js';
import { turnProvenance } from './turn-provenance.js';

type StepRow = typeof step.$inferSelect;
type ThreadRow = typeof chiefThread.$inferSelect;

export function claimPendingChiefStep(
  db: MachineDeps['db'],
  stepRow: StepRow,
  machineId: string | null,
  bindTeamId: string | null = null,
  bindDevinTeamId: string | null = null,
): StepRow | null {
  const claimedAt = nowMs();
  const claimed = db.transaction(() => {
    const res = db
      .update(step)
      .set({
        status: 'claimed',
        machineId,
        claudeSubscriptionId:
          bindTeamId === null
            ? null
            : sql<
                string | null
              >`(select ${claudeSubscription.id} from ${claudeSubscription} where ${claudeSubscription.teamId} = ${bindTeamId} and ${claudeSubscription.enabledAt} is not null and (${claudeSubscription.expiresAt} is null or ${claudeSubscription.expiresAt} > ${claimedAt}))`,
        devinSubscriptionId:
          bindDevinTeamId === null
            ? null
            : sql<
                string | null
              >`(select ${devinSubscription.id} from ${devinSubscription} where ${devinSubscription.teamId} = ${bindDevinTeamId} and ${devinSubscription.enabledAt} is not null and (${devinSubscription.expiresAt} is null or ${devinSubscription.expiresAt} > ${claimedAt}))`,
        claimedAt,
        lastHeartbeatAt: claimedAt,
        holdReason: null,
        holdUntil: null,
      })
      .where(
        and(
          eq(step.id, stepRow.id),
          eq(step.status, 'pending'),
          notInArray(
            step.id,
            db
              .select({ id: coordinatorInput.id })
              .from(coordinatorInput)
              .where(eq(coordinatorInput.state, 'pending')),
          ),
        ),
      )
      .run();
    if (res.changes === 0) return null;
    foldQueuedChiefSteps(db, stepRow, claimedAt);
    return db.select().from(step).where(eq(step.id, stepRow.id)).get() ?? null;
  });
  if (claimed !== null) openTurnCapture(stepRow.id);
  return claimed;
}

function foldQueuedChiefSteps(db: MachineDeps['db'], head: StepRow, now: number): void {
  const owners = head.ownerMessageIds ?? [];
  if (owners.length === 0 || head.prompt === null) return;
  const nativeInputs = new Set(
    db
      .select({ id: coordinatorInput.id })
      .from(coordinatorInput)
      .where(eq(coordinatorInput.threadId, head.buildId))
      .all()
      .map((input) => input.id),
  );
  const later = db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, head.buildId),
        eq(step.kind, 'chief'),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .orderBy(asc(step.createdAt), sql`rowid`)
    .all()
    .filter((row) => row.id !== head.id && row.status !== 'claimed');
  const folded: StepRow[] = [];
  for (const row of later) {
    const foldable =
      row.status === 'pending' &&
      row.prompt !== null &&
      (row.ownerMessageIds ?? []).length > 0 &&
      (row.holdReason === null || row.holdReason === QUEUED_HOLD) &&
      (row.holdUntil === null || row.holdUntil <= now) &&
      row.scopeProjectId === head.scopeProjectId &&
      row.freshSession !== true &&
      !nativeInputs.has(row.id);
    if (!foldable) break;
    folded.push(row);
  }
  if (folded.length === 0) return;
  db.update(step)
    .set({
      prompt: [head.prompt, ...folded.map((row) => row.prompt)].join('\n\n'),
      ownerMessageIds: [
        ...new Set([...owners, ...folded.flatMap((row) => row.ownerMessageIds ?? [])]),
      ],
    })
    .where(eq(step.id, head.id))
    .run();
  db.delete(step)
    .where(
      inArray(
        step.id,
        folded.map((row) => row.id),
      ),
    )
    .run();
}

export function chiefTurnContext(
  deps: MachineDeps,
  stepRow: StepRow,
  threadRow: ThreadRow,
  agentId: string | null,
) {
  const ctx = chiefClaimContext(deps, threadRow.id);
  const trigger = parseChiefTrigger(stepRow.prompt);
  const systemPrompt = ctx?.systemPrompt ?? '';
  let routeSection = '';
  if (ctx && trigger === 'user') {
    const hint = suggestSkillsForMessage(
      stepRow.prompt ?? '',
      scanLocalSkills(deps.skillsDir).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    );
    if (hint) routeSection = formatSkillRouteSection(hint);
  }
  const injected =
    agentId === null
      ? { memories: [], omitted: 0, fileCount: 0 }
      : injectMemoryDocuments(deps.db, {
          agentId,
          teamId: threadRow.teamId,
          threadId: threadRow.id,
          projectId: null,
          recordUse: true,
        });
  const memories = [
    ...injected.memories.map(({ title, content }) => ({ title, content })),
    { title: '记忆文件', content: `${injected.fileCount} 个；用 memories 按需读取。` },
  ];
  const project = projectTurnContextTraced(deps.db, {
    teamId: threadRow.teamId,
    agentId,
    projectId: stepScopeProjectId(stepRow),
    threadId: threadRow.id,
  });
  const recall =
    ctx && trigger === 'user' && agentId !== null
      ? recallMemorySection(
          deps.db,
          { agentId, teamId: threadRow.teamId, threadId: threadRow.id },
          stripTurnContext(stepRow.prompt ?? ''),
          [
            ...injected.memories.map((memory) => `${memory.title}\n${memory.content}`),
            ...(project === null ? [] : [project.text]),
          ],
        )
      : null;
  const sections = [project?.text, routeSection, recall?.text ?? ''].filter(
    (part): part is string => !!part,
  );
  const memoryTrace = {
    teamMemoryIds: ctx?.memoryIds ?? [],
    teamMemoriesOmitted: ctx?.memoriesOmitted ?? 0,
    projectMemoryIds: project?.memoryIds ?? [],
    projectMemoriesOmitted: project?.memoriesOmitted ?? 0,
    recalledMemoryIds: recall?.memoryIds ?? [],
  };
  const instruction =
    stepRow.prompt === null
      ? null
      : [stepRow.prompt, ...sections].filter((part) => part).join('\n\n');
  return { trigger, systemPrompt, memories, instruction, sections, memoryTrace };
}

export function latestChiefMemoryUsage(db: Db, teamId: string) {
  const row = db
    .select({
      stepId: step.id,
      threadId: step.buildId,
      createdAt: step.createdAt,
      memoryTrace: step.memoryTrace,
    })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(chiefThread.teamId, teamId),
        eq(step.kind, 'chief'),
        notLike(chiefThread.id, 'chief-memory-%'),
        isNotNull(step.memoryTrace),
      ),
    )
    .orderBy(desc(step.createdAt))
    .limit(1)
    .get();
  if (row === undefined || row.memoryTrace === null) return null;
  return {
    stepId: row.stepId,
    threadId: row.threadId,
    createdAt: row.createdAt,
    ...row.memoryTrace,
  };
}

export function finishCoordinatorTurn(
  deps: MachineDeps,
  stepRow: StepRow,
  outcome: MachineDoneBody,
  observation?: OtelObservation,
): void {
  const { db } = deps;
  try {
    const teamId = stepTeamId(deps, stepRow);
    if (teamId !== null) sealCoordinatorTurnSnapshot(db, stepRow, teamId, outcome.status, nowMs());
  } catch {}
  const provenance = turnProvenance(stepRow.prompt);
  const reportedSessionId =
    provenance?.startsWith('mail:') === true || provenance?.startsWith('im:') === true
      ? undefined
      : outcome.sessionId;
  db.update(step)
    .set({
      ...(reportedSessionId !== undefined ? { sessionId: reportedSessionId } : {}),
      status:
        outcome.status === 'success' ? 'done' : outcome.status === 'stopped' ? 'stopped' : 'failed',
      ...(outcome.status === 'stopped' ? { finishedAt: nowMs() } : {}),
    })
    .where(eq(step.id, stepRow.id))
    .run();
  if (outcome.status === 'stopped') recordChiefStop(deps, stepRow);
  publishStepStatus(deps, stepRow.id);
  cancelPendingQuestions(
    {
      db: deps.db,
      hub: deps.hub,
      user: deps.user,
      ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
    },
    stepRow.buildId,
    '回合已结束',
  );
  finishChiefTurn(deps, stepRow.buildId, { ...outcome, sessionId: reportedSessionId });
  settleMemoryEditTurn(
    db,
    stepRow,
    outcome.status === 'success' ? 'success' : outcome.status === 'stopped' ? 'stopped' : 'failed',
    outcome.errorMessage ?? undefined,
  );
  if (outcome.status === 'success')
    notifyChiefTurn(
      deps,
      stepRow.buildId,
      stepRow.prompt,
      steeredMessageScopes(deps.db, stepRow).length > 0,
    );
  if (outcome.status === 'failed') recoverGateWake(deps, stepRow);
  if (outcome.status === 'failed' && outcome.errorMessage) {
    upsertChiefRow(deps, {
      id: `chief-err-${stepRow.id}`,
      threadId: stepRow.buildId,
      role: 'system',
      content: JSON.stringify({
        kind: CHIEF_TURN_ERROR_KIND,
        message: outcome.errorMessage,
        ...turnErrorFacts(deps, stepRow),
      }),
      createdAt: nowMs(),
    });
  }
  const finished = db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (finished !== undefined) imTurnFinished(finished);
  emitRuntimeStepSpan(deps.db, stepRow.id, process.env, observation);
}

function turnErrorFacts(deps: MachineDeps, stepRow: StepRow) {
  const elapsed =
    stepRow.claimedAt === null ? {} : { elapsedMs: Math.max(0, nowMs() - stepRow.claimedAt) };
  const teamId = stepTeamId(deps, stepRow);
  if (teamId === null) return elapsed;
  const projectId =
    deps.db
      .select({ projectId: chiefThread.projectId })
      .from(chiefThread)
      .where(eq(chiefThread.id, stepRow.buildId))
      .get()?.projectId ?? null;
  const profile = coordinatorProfile(deps.db, teamId, projectId);
  const ran = stepRow.fallback?.model ?? {
    provider: profile?.provider ?? null,
    modelId: profile?.modelId ?? null,
  };
  if (ran.provider == null) return elapsed;
  const row = deps.db
    .select({ id: provider.id, label: provider.label, models: provider.models })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, ran.provider)))
    .get();
  if (row === undefined) return elapsed;
  const modelId = ran.modelId ?? null;
  return {
    ...elapsed,
    providerId: row.id,
    provider: row.label,
    ...(modelId === null
      ? {}
      : { model: row.models.find((m) => m.id === modelId)?.name || modelId }),
  };
}

export function recordStepUsage(
  deps: MachineDeps,
  stepRow: StepRow,
  usage: readonly ModelUsage[],
): void {
  const { db } = deps;
  const usageTeamId = stepTeamId(deps, stepRow);
  const mirrorsTurnUsage =
    coordinatorRunsOnPi() && stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId);
  db.transaction((tx) => {
    for (const u of usage) {
      const prior = db
        .select()
        .from(tokenUsage)
        .where(and(eq(tokenUsage.buildId, stepRow.buildId), eq(tokenUsage.model, u.model)))
        .get();
      const tokens = {
        input: (prior?.input ?? 0) + u.input,
        output: (prior?.output ?? 0) + u.output,
        cacheRead: (prior?.cacheRead ?? 0) + u.cacheRead,
        cacheWrite: (prior?.cacheWrite ?? 0) + u.cacheWrite,
      };
      const rates = ratesForModel(db, usageTeamId, u.model);
      const reported = u.cost;
      const cost = rates
        ? costFromRates(tokens, rates)
        : reported !== undefined &&
            (reported.input !== 0 ||
              reported.output !== 0 ||
              reported.cacheRead !== 0 ||
              reported.cacheWrite !== 0 ||
              reported.total !== 0)
          ? {
              costInput: (prior?.costInput ?? 0) + reported.input,
              costOutput: (prior?.costOutput ?? 0) + reported.output,
              costCacheRead: (prior?.costCacheRead ?? 0) + reported.cacheRead,
              costCacheWrite: (prior?.costCacheWrite ?? 0) + reported.cacheWrite,
              costTotal: (prior?.costTotal ?? 0) + reported.total,
            }
          : null;
      tx.insert(tokenUsage)
        .values({
          buildId: stepRow.buildId,
          model: u.model,
          ...tokens,
          costInput: cost?.costInput ?? null,
          costOutput: cost?.costOutput ?? null,
          costCacheRead: cost?.costCacheRead ?? null,
          costCacheWrite: cost?.costCacheWrite ?? null,
          costTotal: cost?.costTotal ?? null,
        })
        .onConflictDoUpdate({
          target: [tokenUsage.buildId, tokenUsage.model],
          set: cost === null ? tokens : { ...tokens, ...cost },
        })
        .run();
      if (mirrorsTurnUsage) {
        tx.insert(chiefTurnUsage)
          .values({
            stepId: stepRow.id,
            threadId: stepRow.buildId,
            model: u.model,
            input: u.input,
            output: u.output,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
            cacheWrite1h: u.cacheWrite1h ?? 0,
            ttftMs: u.ttftMs ?? null,
            contextTokens: u.contextTokens ?? null,
            contextWindow: u.contextWindow ?? null,
            compactAt: u.compactAt ?? null,
            createdAt: nowMs(),
          })
          .onConflictDoUpdate({
            target: [chiefTurnUsage.stepId, chiefTurnUsage.model],
            set: {
              input: sql`${chiefTurnUsage.input} + ${u.input}`,
              output: sql`${chiefTurnUsage.output} + ${u.output}`,
              cacheRead: sql`${chiefTurnUsage.cacheRead} + ${u.cacheRead}`,
              cacheWrite: sql`${chiefTurnUsage.cacheWrite} + ${u.cacheWrite}`,
              cacheWrite1h: sql`${chiefTurnUsage.cacheWrite1h} + ${u.cacheWrite1h ?? 0}`,
              ttftMs: sql`coalesce(${chiefTurnUsage.ttftMs}, ${u.ttftMs ?? null})`,
              ...(u.contextTokens !== undefined
                ? {
                    contextTokens: u.contextTokens,
                    contextWindow: u.contextWindow ?? null,
                    compactAt: u.compactAt ?? null,
                  }
                : {}),
            },
          })
          .run();
      }
      if (usageTeamId !== null) {
        const mirrored = mirrorsTurnUsage ? u.input + u.output + u.cacheRead + u.cacheWrite : 0;
        tx.insert(stepUsage)
          .values({
            stepId: stepRow.id,
            model: u.model,
            teamId: usageTeamId,
            buildId: stepRow.buildId,
            kind: stepRow.kind,
            input: u.input,
            output: u.output,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
            cacheWrite1h: u.cacheWrite1h ?? 0,
            mirroredTokens: mirrored,
            contextTokens: u.contextTokens ?? null,
            contextWindow: u.contextWindow ?? null,
            compactAt: u.compactAt ?? null,
            createdAt: nowMs(),
          })
          .onConflictDoUpdate({
            target: [stepUsage.stepId, stepUsage.model],
            set: {
              input: sql`${stepUsage.input} + ${u.input}`,
              output: sql`${stepUsage.output} + ${u.output}`,
              cacheRead: sql`${stepUsage.cacheRead} + ${u.cacheRead}`,
              cacheWrite: sql`${stepUsage.cacheWrite} + ${u.cacheWrite}`,
              cacheWrite1h: sql`${stepUsage.cacheWrite1h} + ${u.cacheWrite1h ?? 0}`,
              mirroredTokens: sql`${stepUsage.mirroredTokens} + ${mirrored}`,
              ...(u.contextTokens !== undefined
                ? {
                    contextTokens: u.contextTokens,
                    contextWindow: u.contextWindow ?? null,
                    compactAt: u.compactAt ?? null,
                  }
                : {}),
            },
          })
          .run();
      }
    }
  });
}

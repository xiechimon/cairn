import type {
  ChiefChannelUsage,
  ChiefUsageMachineEntry,
  ChiefUsageModelEntry,
  ContextCache,
} from '@cairn/shared';
import {
  COORDINATOR_COMPACT_AT,
  isBackendRuntimeId,
  parseModelKey,
  tokenUsageSchema,
} from '@cairn/shared';
import { and, asc, desc, eq, gt, inArray, type SQL } from 'drizzle-orm';
import {
  type ContextResume,
  cacheTtlMsFor,
  contextResumeOf,
  resolveCacheRetentionTier,
  resumeExpiresAtOf,
} from '../coordinator/runtime/cold-slim.js';
import { compactionWindow } from '../coordinator/runtime/compaction.js';
import { catalogContextWindow, DEFAULT_CONTEXT_WINDOW } from '../coordinator/runtime/provider.js';
import type { Db } from '../db/client.js';
import {
  chiefThread,
  chiefTurnUsage,
  machine,
  provider,
  step,
  stepQuota,
  tokenUsage,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { stepRuntimeFor } from './dispatch-eligibility.js';
import { loadTeamModelCatalog, resolveTeamModelEntry } from './model-catalog.js';
import { coordinatorProfile } from './routing-rules.js';

export { DEFAULT_CONTEXT_WINDOW };

let inServer = false;
let wakeThread: (threadId: string) => void = () => {};

export function setCoordinatorInServer(on: boolean): void {
  inServer = on;
}

export function coordinatorInServerEnabled(): boolean {
  return inServer;
}

export function setCoordinatorWake(wake: (threadId: string) => void): void {
  wakeThread = wake;
}

export function wakeCoordinator(threadId: string): void {
  wakeThread(threadId);
}

export function coordinatorRunsOnPi(): boolean {
  return inServer;
}

export function contextWindowOf(db: Db, teamId: string, usageModel: string): number {
  const slash = usageModel.indexOf('/');
  if (slash <= 0) return DEFAULT_CONTEXT_WINDOW;
  const providerId = usageModel.slice(0, slash);
  const modelId = usageModel.slice(slash + 1);
  const providerRow = db
    .select({ models: provider.models })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  return (
    providerRow?.models.find((m) => m.id === modelId)?.contextWindow ??
    catalogContextWindow(providerId, modelId)
  );
}

export function activeRouterModel(db: Db, teamId: string): string | null {
  const profile = coordinatorProfile(db, teamId);
  const providerId = profile?.provider?.trim() ?? '';
  const modelId = profile?.modelId?.trim() ?? '';
  if (providerId === '' || modelId === '') return null;
  return `${providerId}/${modelId}`;
}

export type ContextBearingTurnUsage = {
  stepId: string;
  threadId: string;
  model: string;
  createdAt: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  input: number;
  contextTokens: number;
  contextWindow: number | null;
  compactAt: number | null;
};

export type TurnUsageForColdResume = {
  stepId: string;
  threadId: string;
  model: string;
  createdAt: number;
  cacheRead: number;
  input: number;
  contextTokens: number | null;
};

function latestTurnUsageStepId(db: Db, scope: SQL): string | null {
  return (
    db
      .select({ stepId: chiefTurnUsage.stepId })
      .from(chiefTurnUsage)
      .where(scope)
      .orderBy(desc(chiefTurnUsage.createdAt))
      .get()?.stepId ?? null
  );
}

function lastContextBearingTurnUsageWhere(db: Db, scope: SQL): ContextBearingTurnUsage | null {
  const stepId = latestTurnUsageStepId(db, scope);
  if (stepId == null) return null;
  const last = db
    .select({
      contextTokens: chiefTurnUsage.contextTokens,
      contextWindow: chiefTurnUsage.contextWindow,
      compactAt: chiefTurnUsage.compactAt,
      model: chiefTurnUsage.model,
      createdAt: chiefTurnUsage.createdAt,
      cacheRead: chiefTurnUsage.cacheRead,
      cacheWrite: chiefTurnUsage.cacheWrite,
      cacheWrite1h: chiefTurnUsage.cacheWrite1h,
      input: chiefTurnUsage.input,
      threadId: chiefTurnUsage.threadId,
      stepId: chiefTurnUsage.stepId,
    })
    .from(chiefTurnUsage)
    .where(and(eq(chiefTurnUsage.stepId, stepId), gt(chiefTurnUsage.contextTokens, 0)))
    .orderBy(desc(chiefTurnUsage.createdAt))
    .get();
  if (last?.contextTokens == null) return null;
  return {
    stepId: last.stepId,
    threadId: last.threadId,
    model: last.model,
    createdAt: last.createdAt,
    cacheRead: last.cacheRead,
    cacheWrite: last.cacheWrite,
    cacheWrite1h: last.cacheWrite1h,
    input: last.input,
    contextTokens: last.contextTokens,
    contextWindow: last.contextWindow,
    compactAt: last.compactAt,
  };
}

export function lastContextBearingTurnUsage(
  db: Db,
  threadId: string,
): ContextBearingTurnUsage | null {
  return lastContextBearingTurnUsageWhere(db, eq(chiefTurnUsage.threadId, threadId));
}

const SESSION_ROTATING_RUNTIMES: ReadonlySet<string> = new Set(['devin', 'antigravity', 'doubao']);

export function rotatesPastCompaction(db: Db, threadId: string, runtime: string): boolean {
  if (!SESSION_ROTATING_RUNTIMES.has(runtime)) return false;
  const last = lastContextBearingTurnUsage(db, threadId);
  return last !== null && last.contextTokens >= COORDINATOR_COMPACT_AT;
}

export function lastTurnUsageForColdResume(
  db: Db,
  threadId: string,
): TurnUsageForColdResume | null {
  const scope = eq(chiefTurnUsage.threadId, threadId);
  const bearing = lastContextBearingTurnUsageWhere(db, scope);
  if (bearing !== null) return bearing;
  const stepId = latestTurnUsageStepId(db, scope);
  if (stepId == null) return null;
  const raw = db
    .select({
      contextTokens: chiefTurnUsage.contextTokens,
      model: chiefTurnUsage.model,
      createdAt: chiefTurnUsage.createdAt,
      cacheRead: chiefTurnUsage.cacheRead,
      input: chiefTurnUsage.input,
      threadId: chiefTurnUsage.threadId,
      stepId: chiefTurnUsage.stepId,
    })
    .from(chiefTurnUsage)
    .where(eq(chiefTurnUsage.stepId, stepId))
    .orderBy(desc(chiefTurnUsage.createdAt))
    .get();
  if (raw === undefined) return null;
  return {
    stepId: raw.stepId,
    threadId: raw.threadId,
    model: raw.model,
    createdAt: raw.createdAt,
    cacheRead: raw.cacheRead,
    input: raw.input,
    contextTokens: raw.contextTokens ?? null,
  };
}

export function lastTurnContext(
  db: Db,
  chiefRow: { id: string; teamId: string },
  threadId?: string,
): {
  tokens: number;
  contextWindow: number;
  compactAt?: number;
  resume: ContextResume;
  resumeExpiresAt?: number;
  resumeExpiresInMs?: number;
  cache: ContextCache;
} | null {
  if (threadId !== undefined) {
    const owned = db
      .select({ id: chiefThread.id })
      .from(chiefThread)
      .where(and(eq(chiefThread.chiefId, chiefRow.id), eq(chiefThread.id, threadId)))
      .get();
    if (owned === undefined) return null;
  }
  const scope =
    threadId !== undefined
      ? eq(chiefTurnUsage.threadId, threadId)
      : inArray(
          chiefTurnUsage.threadId,
          db
            .select({ id: chiefThread.id })
            .from(chiefThread)
            .where(eq(chiefThread.chiefId, chiefRow.id)),
        );
  const last = lastContextBearingTurnUsageWhere(db, scope);
  if (last == null) return null;
  const retentionMs = cacheTtlMsFor(resolveCacheRetentionTier(), last.model, {
    total: last.cacheWrite,
    oneHour: last.cacheWrite1h,
  });
  const now = nowMs();
  const resume = contextResumeOf({
    lastUsage: {
      createdAt: last.createdAt,
      cacheRead: last.cacheRead,
      input: last.input,
      contextTokens: last.contextTokens,
      model: last.model,
    },
    activeModel: activeRouterModel(db, chiefRow.teamId),
  });
  const resumeExpiresAt = resumeExpiresAtOf({
    resume,
    retentionMs,
    lastUsageCreatedAt: last.createdAt,
  });
  const contextWindow = last.contextWindow ?? contextWindowOf(db, chiefRow.teamId, last.model);
  const compactAt =
    last.compactAt ??
    (isBackendRuntimeId(last.model.slice(0, last.model.indexOf('/')))
      ? undefined
      : compactionWindow(contextWindow).backgroundAt);
  return {
    tokens: last.contextTokens,
    contextWindow,
    ...(compactAt !== undefined ? { compactAt } : {}),
    resume,
    ...(resumeExpiresAt !== null
      ? {
          resumeExpiresAt,
          resumeExpiresInMs: Math.max(0, resumeExpiresAt - now),
        }
      : {}),
    cache: { read: last.cacheRead, write: last.cacheWrite, input: last.input },
  };
}

const HARNESS_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  pi: 'Cairn',
  devin: 'Devin',
  antigravity: 'Antigravity',
  doubao: '豆包',
  gemini: 'Gemini',
};

function engineRuntimeForProvider(providerId: string | null | undefined): string | null {
  if (providerId == null || providerId === '') return null;
  return stepRuntimeFor(providerId);
}

function engineLabelForRuntime(runtime: string | null | undefined): string | null {
  if (runtime == null || runtime === '') return null;
  return HARNESS_LABELS[runtime] ?? null;
}

function modelDedupKey(entry: ChiefUsageModelEntry): string {
  return `${entry.provider ?? ''}:${entry.modelId}`;
}

export function channelUsageSummary(
  db: Db,
  chiefRow: { id: string; teamId: string },
  threadId?: string,
): ChiefChannelUsage | null {
  let threadIds: string[];
  if (threadId !== undefined) {
    const owned = db
      .select({ id: chiefThread.id })
      .from(chiefThread)
      .where(
        and(
          eq(chiefThread.chiefId, chiefRow.id),
          eq(chiefThread.teamId, chiefRow.teamId),
          eq(chiefThread.id, threadId),
        ),
      )
      .get();
    if (owned === undefined) return null;
    threadIds = [owned.id];
  } else {
    threadIds = db
      .select({ id: chiefThread.id })
      .from(chiefThread)
      .where(and(eq(chiefThread.chiefId, chiefRow.id), eq(chiefThread.teamId, chiefRow.teamId)))
      .all()
      .map((row) => row.id);
  }
  if (threadIds.length === 0) return null;
  const rows = db
    .select()
    .from(tokenUsage)
    .where(inArray(tokenUsage.buildId, threadIds))
    .orderBy(asc(tokenUsage.buildId), asc(tokenUsage.model))
    .all()
    .map((row) => tokenUsageSchema.parse(row));
  const steps = db
    .select({
      id: step.id,
      status: step.status,
      claimedAt: step.claimedAt,
      createdAt: step.createdAt,
      finishedAt: step.finishedAt,
      ranModel: stepQuota.ranModel,
      machineId: step.machineId,
      machineName: machine.name,
      machineCapabilities: machine.capabilities,
    })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .leftJoin(machine, and(eq(machine.id, step.machineId), eq(machine.teamId, chiefRow.teamId)))
    .where(and(inArray(step.buildId, threadIds), eq(step.kind, 'chief')))
    .orderBy(asc(step.claimedAt), asc(step.createdAt))
    .all();
  const started = steps.filter((row) => row.claimedAt !== null);
  const turns = started.length;
  if (rows.length === 0 && turns === 0) return null;
  const now = nowMs();
  const measurable = started.filter((row) => row.finishedAt !== null || row.status === 'claimed');
  const durationSeconds =
    measurable.length === 0
      ? null
      : measurable.reduce(
          (sum, row) => sum + Math.max(0, (row.finishedAt ?? now) - (row.claimedAt ?? now)),
          0,
        ) / 1000;
  const stepEngines = started
    .map((row) => engineLabelForRuntime(engineRuntimeForProvider(row.ranModel?.provider)))
    .filter((label): label is string => label !== null);
  const rowEngines =
    stepEngines.length > 0
      ? stepEngines
      : rows
          .map((row) =>
            engineLabelForRuntime(engineRuntimeForProvider(parseModelKey(row.model).provider)),
          )
          .filter((label): label is string => label !== null);
  const machines = [
    ...new Set(
      started
        .map((row) => row.machineName)
        .filter((name): name is string => name !== null && name.trim() !== ''),
    ),
  ];

  const catalog = loadTeamModelCatalog(db, chiefRow.teamId);
  const stepProviderByModelId = new Map<string, string>();
  for (const row of started) {
    if (row.ranModel?.modelId != null && row.ranModel.provider != null) {
      stepProviderByModelId.set(row.ranModel.modelId, row.ranModel.provider);
    }
  }
  const turnModels = db
    .select({ stepId: chiefTurnUsage.stepId, model: chiefTurnUsage.model })
    .from(chiefTurnUsage)
    .where(inArray(chiefTurnUsage.threadId, threadIds))
    .orderBy(asc(chiefTurnUsage.createdAt))
    .all();

  const latestStep = started.at(-1) ?? null;
  const latestTurn = turnModels.at(-1) ?? null;
  const latestEngineRuntime =
    engineRuntimeForProvider(latestStep?.ranModel?.provider) ??
    (latestTurn !== null
      ? engineRuntimeForProvider(parseModelKey(latestTurn.model).provider)
      : null) ??
    (rows.at(-1) !== undefined
      ? engineRuntimeForProvider(parseModelKey(rows.at(-1)?.model ?? '').provider)
      : null);
  const latestEngine = engineLabelForRuntime(latestEngineRuntime);

  const latestModelEntry = (() => {
    const ran = latestStep?.ranModel;
    if (ran?.modelId != null) {
      const matchingRow = rows.find(
        (r) => r.model === `${ran.provider}/${ran.modelId}` || r.model === ran.modelId,
      );
      return resolveTeamModelEntry(
        catalog,
        matchingRow?.model ??
          (ran.provider != null ? `${ran.provider}/${ran.modelId}` : ran.modelId),
        ran.provider ?? null,
      );
    }
    const raw = latestTurn?.model ?? rows.at(-1)?.model ?? null;
    if (raw === null) return null;
    return resolveTeamModelEntry(
      catalog,
      raw,
      stepProviderByModelId.get(parseModelKey(raw).modelId) ?? null,
    );
  })();

  const machineDetails: ChiefUsageMachineEntry[] = [];
  const seenMachines = new Set<string>();
  for (const row of [...started].reverse()) {
    if (row.machineName === null || row.machineName.trim() === '') continue;
    const key = row.machineId ?? row.machineName;
    if (seenMachines.has(key)) continue;
    seenMachines.add(key);
    machineDetails.push({
      id: row.machineId ?? null,
      name: row.machineName,
      osPlatform: row.machineCapabilities?.osPlatform ?? null,
      osDistribution: row.machineCapabilities?.osDistribution ?? null,
    });
  }
  const latestMachine: ChiefUsageMachineEntry | null =
    latestStep?.machineName != null && latestStep.machineName.trim() !== ''
      ? {
          id: latestStep.machineId ?? null,
          name: latestStep.machineName,
          osPlatform: latestStep.machineCapabilities?.osPlatform ?? null,
          osDistribution: latestStep.machineCapabilities?.osDistribution ?? null,
        }
      : null;

  const models: ChiefUsageModelEntry[] = [];
  const seenModelKeys = new Set<string>();
  const pushModel = (entry: ChiefUsageModelEntry | null) => {
    if (entry === null) return;
    const key = modelDedupKey(entry);
    if (seenModelKeys.has(key)) return;
    seenModelKeys.add(key);
    models.push(entry);
  };
  pushModel(latestModelEntry);
  for (const turn of [...turnModels].reverse()) {
    const parsed = parseModelKey(turn.model);
    pushModel(
      resolveTeamModelEntry(catalog, turn.model, stepProviderByModelId.get(parsed.modelId) ?? null),
    );
  }
  for (const row of rows) {
    const parsed = parseModelKey(row.model);
    pushModel(
      resolveTeamModelEntry(catalog, row.model, stepProviderByModelId.get(parsed.modelId) ?? null),
    );
  }

  return {
    rows,
    durationSeconds,
    engines: [...new Set(rowEngines)],
    machines,
    turns,
    latest: {
      engine: latestEngine,
      engineRuntime: latestEngineRuntime,
      model: latestModelEntry,
      machine: latestMachine,
    },
    models,
    machineDetails,
  };
}

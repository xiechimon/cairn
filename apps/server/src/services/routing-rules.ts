import {
  CODEX_MODEL,
  type CoordinatorDefault,
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_DEVIN_MODELS,
  filterAgentTools,
  isInternalAntigravityModelId,
  isSessionStepKind,
  type PatchRoutingRuleBody,
  type PatchWorkPolicyBody,
  type PolicyUse,
  type ProjectModelChoice,
  type ProjectModelUse,
  type RemoteToolDef,
  type RequiredCapabilities,
  ROUTE_USES,
  type RouteOverride,
  type RouteUse,
  type RoutingRuleRecord,
  type RunnerOs,
  runnerOsOf,
  type SessionDefault,
  type StepKind,
  type TaskRequest,
  type TeamRoutingSettings,
  type TodoOutputKind,
  type TodoSourceKind,
  type WorkPolicyRecord,
  withPlatform,
} from '@cairn/shared';
import { and, asc, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import { builtinModelIds } from '../coordinator/runtime/provider.js';
import type { Db } from '../db/client.js';
import {
  build,
  chief,
  devinSubscription,
  machine,
  project,
  provider,
  routingRule,
  step,
  todo,
  workPolicy,
} from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { activeAntigravitySource } from './antigravity-subscriptions.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { coordinatorToolDefs } from './coordinator-tool-defs.js';
import {
  antigravityUsable,
  claudeCodeUsable,
  devinUsable,
  doubaoUsable,
  machineRuntimeAvailable,
  requiredGithubPushRepoForStep,
  stepRuntimeFor,
} from './dispatch-eligibility.js';
import { activeDoubaoSource, DEFAULT_DOUBAO_FALLBACK_MODELS } from './doubao-subscriptions.js';
import { DEFAULT_SESSION_MODEL, DEFAULT_SESSION_PROVIDER } from './routing-migration.js';
import { isKeylessEndpoint, listConnectedTierSources, tierFallbackChain } from './source-tiers.js';
import { decideStepRoute, primarySourceOnlyOffline } from './step-route.js';

type RoutingRuleRow = typeof routingRule.$inferSelect;
type WorkPolicyRow = typeof workPolicy.$inferSelect;

export interface RouteProfile {
  id: string;
  teamId: string;
  displayName: string;
  description: string | null;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  machineId: string | null;
  tools: string[];
  secrets: string[];
  defaultSkill: string | null;
  skillsAllowlist: string[] | null;
  requiredCapabilities: RequiredCapabilities | null;
  fallbackModels: RoutingRuleRow['fallbackModels'];
  routed: boolean;
  switchedFrom?: { provider: string; modelId: string; reason: string };
}

export interface RoutedTodo {
  teamId: string;
  projectId?: string | null;
  output?: TodoOutputKind | null;
  sourceKind?: TodoSourceKind | null;
  sourceRef?: string | null;
  routeOverride?: RouteOverride | null;
  request?: TaskRequest | null;
}

const USE_DISPLAY_NAMES: Record<RouteUse, string> = {
  coordinator: 'Coordinator',
  session: 'Session',
  review: 'Reviewer',
  compaction: 'Compaction',
};

export function chiefRemoteTools(): readonly RemoteToolDef[] {
  return coordinatorToolDefs();
}

const LEGACY_RUNTIME_PROVIDER = 'pi';
const DEFAULT_SESSION_RULE_ID = 'default-session';
const DEFAULT_COORDINATOR_RULE_ID = 'default-coordinator';
const COORDINATOR_MODEL_PREFERENCE = [/haiku/i, /sonnet/i];
const CLAUDE_CODE_COORDINATOR_MODEL = 'claude-sonnet-5-5';
const ANTHROPIC_API_HOST = 'api.anthropic.com';

export const keylessEndpoint = isKeylessEndpoint;

function servingProviders(
  db: Pick<Db, 'select'>,
  teamId: string,
  modelId: string | null,
  storedOnly = false,
): { providerId: string; runnable: boolean }[] {
  return db
    .select({
      providerId: provider.providerId,
      models: provider.models,
      keyed: sql<number>`${provider.apiKeyCipher} is not null`,
    })
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .orderBy(asc(provider.createdAt), asc(provider.id))
    .all()
    .flatMap((row) => {
      const stored =
        modelId === null ? row.models.length > 0 : row.models.some((m) => m.id === modelId);
      const builtin =
        !storedOnly && modelId !== null && builtinModelIds(row.providerId).has(modelId);
      if (!stored && !builtin) return [];
      const runnable = row.keyed === 1 || keylessEndpoint(row.providerId);
      return [
        { providerId: row.providerId, runnable, rank: (stored ? 0 : 2) + (runnable ? 0 : 1) },
      ];
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ providerId, runnable }) => ({ providerId, runnable }));
}

export function resolveRuleProvider<T extends RoutingRuleRow>(
  db: Pick<Db, 'select'>,
  rule: T,
  storedOnly = false,
): T {
  if (rule.provider !== LEGACY_RUNTIME_PROVIDER) return rule;
  const ownRow = db
    .select({ id: provider.id })
    .from(provider)
    .where(and(eq(provider.teamId, rule.teamId), eq(provider.providerId, LEGACY_RUNTIME_PROVIDER)))
    .get();
  if (ownRow !== undefined) return rule;
  const served = servingProviders(db, rule.teamId, rule.modelId, storedOnly)[0];
  return served === undefined ? rule : { ...rule, provider: served.providerId };
}

function storedRuleRow(
  db: Pick<Db, 'select'>,
  teamId: string,
  use: RouteUse,
): RoutingRuleRow | null {
  return (
    db
      .select()
      .from(routingRule)
      .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, use)))
      .get() ?? null
  );
}

function ruleRow(db: Pick<Db, 'select'>, teamId: string, use: RouteUse): RoutingRuleRow | null {
  const row = storedRuleRow(db, teamId, use);
  return row === null ? null : resolveRuleProvider(db, row);
}

function providerSessionChoice(
  db: Pick<Db, 'select'>,
  teamId: string,
): { provider: string; modelId: string } | null {
  const rows = db
    .select({ providerId: provider.providerId, models: provider.models })
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .all();
  for (const { providerId, runnable } of servingProviders(db, teamId, null)) {
    if (!runnable) continue;
    const models = rows.find((row) => row.providerId === providerId)?.models ?? [];
    const model = models.find((m) => m.id !== '');
    if (model !== undefined) return { provider: providerId, modelId: model.id };
  }
  return null;
}

function antigravityDefaultModelId(db: Pick<Db, 'select'>, teamId: string): string | null {
  if (!antigravityUsable(db, teamId)) return null;
  const source = activeAntigravitySource(db, teamId);
  if (source.kind === 'none') return null;
  const raw =
    source.models.length > 0
      ? source.models
      : source.kind === 'host' && source.login.status === 'ok' && source.login.models.length > 0
        ? source.login.models
        : DEFAULT_ANTIGRAVITY_MODELS;
  const usable = raw.filter((model) => model.id !== '' && !isInternalAntigravityModelId(model.id));
  return usable.find((model) => model.id === 'gemini-3.8-flash')?.id ?? usable[0]?.id ?? null;
}

function devinDefaultModelId(db: Pick<Db, 'select'>, teamId: string): string | null {
  if (!devinUsable(db, teamId)) return null;
  const now = nowMs();
  const row = db
    .select({ models: devinSubscription.models })
    .from(devinSubscription)
    .where(
      and(
        eq(devinSubscription.teamId, teamId),
        isNotNull(devinSubscription.enabledAt),
        or(
          sql`${devinSubscription.expiresAt} is null`,
          sql`${devinSubscription.expiresAt} > ${now}`,
        ),
      ),
    )
    .get();
  const raw = row && row.models.length > 0 ? row.models : DEFAULT_DEVIN_MODELS;
  return raw.find((model) => model.id !== '')?.id ?? null;
}

export function defaultSessionChoice(
  db: Pick<Db, 'select'>,
  teamId: string,
): (SessionDefault & { provider: string; modelId: string }) | null {
  const coordinator = ruleRow(db, teamId, 'coordinator');
  if (coordinator !== null) {
    return { reason: 'coordinator', provider: coordinator.provider, modelId: coordinator.modelId };
  }
  if (claudeCodeUsable(db, teamId)) {
    return {
      reason: 'claude-code',
      provider: DEFAULT_SESSION_PROVIDER,
      modelId: DEFAULT_SESSION_MODEL,
    };
  }
  const choice = providerSessionChoice(db, teamId);
  if (choice !== null) return { reason: 'provider', ...choice };
  const antigravityModel = antigravityDefaultModelId(db, teamId);
  if (antigravityModel !== null) {
    return { reason: 'antigravity', provider: 'antigravity', modelId: antigravityModel };
  }
  const devinModel = devinDefaultModelId(db, teamId);
  if (devinModel !== null) return { reason: 'devin', provider: 'devin', modelId: devinModel };
  const doubaoModel = doubaoDefaultModelId(db, teamId);
  return doubaoModel === null
    ? null
    : { reason: 'doubao', provider: 'doubao', modelId: doubaoModel };
}

function doubaoDefaultModelId(db: Pick<Db, 'select'>, teamId: string): string | null {
  if (!doubaoUsable(db, teamId)) return null;
  const source = activeDoubaoSource(db, teamId);
  if (source.kind === 'none') return null;
  const raw =
    source.models.length > 0
      ? source.models
      : source.login.models.length > 0
        ? source.login.models
        : DEFAULT_DOUBAO_FALLBACK_MODELS;
  return raw.find((model) => model.id !== '')?.id ?? null;
}

function isAnthropicApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === ANTHROPIC_API_HOST;
  } catch {
    return false;
  }
}

export function anthropicCoordinatorChoice(
  db: Pick<Db, 'select'>,
  teamId: string,
): { provider: string; modelId: string } | null {
  const source = db
    .select({ providerId: provider.providerId, models: provider.models, baseUrl: provider.baseUrl })
    .from(provider)
    .where(
      and(
        eq(provider.teamId, teamId),
        eq(provider.api, 'anthropic-messages'),
        isNotNull(provider.apiKeyCipher),
      ),
    )
    .orderBy(asc(provider.createdAt), asc(provider.id))
    .all()
    .find((row) => isAnthropicApi(row.baseUrl) && row.models.length > 0);
  if (source === undefined) return null;
  const ids = source.models.map((m) => m.id);
  const modelId =
    COORDINATOR_MODEL_PREFERENCE.map((re) => ids.find((id) => re.test(id))).find(
      (id) => id !== undefined,
    ) ?? ids[0];
  return modelId === undefined ? null : { provider: source.providerId, modelId };
}

export function defaultCoordinatorChoice(
  db: Pick<Db, 'select'>,
  teamId: string,
): (CoordinatorDefault & { provider: string; modelId: string }) | null {
  const anthropic = anthropicCoordinatorChoice(db, teamId);
  if (anthropic !== null) return { reason: 'anthropic-key', ...anthropic };
  const rows = db
    .select({
      providerId: provider.providerId,
      models: provider.models,
      keyed: sql<number>`${provider.apiKeyCipher} is not null`,
    })
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .orderBy(asc(provider.createdAt), asc(provider.id))
    .all();
  for (const row of rows) {
    if (row.keyed !== 1 && !keylessEndpoint(row.providerId)) continue;
    const model = row.models.find((m) => m.id !== '');
    if (model !== undefined) {
      return { reason: 'provider', provider: row.providerId, modelId: model.id };
    }
  }
  if (claudeCodeUsable(db, teamId)) {
    return {
      reason: 'claude-code',
      provider: 'claude-code',
      modelId: CLAUDE_CODE_COORDINATOR_MODEL,
    };
  }
  const antigravityModel = antigravityDefaultModelId(db, teamId);
  if (antigravityModel !== null) {
    return { reason: 'antigravity', provider: 'antigravity', modelId: antigravityModel };
  }
  const devinModel = devinDefaultModelId(db, teamId);
  if (devinModel !== null) return { reason: 'devin', provider: 'devin', modelId: devinModel };
  const doubaoModel = doubaoDefaultModelId(db, teamId);
  return doubaoModel === null
    ? null
    : { reason: 'doubao', provider: 'doubao', modelId: doubaoModel };
}

export function defaultCoordinatorRule(
  db: Pick<Db, 'select'>,
  teamId: string,
): RoutingRuleRow | null {
  const choice = defaultCoordinatorChoice(db, teamId);
  return choice === null ? null : syntheticRule(teamId, 'coordinator', choice);
}

function defaultSessionRule(db: Pick<Db, 'select'>, teamId: string): RoutingRuleRow | null {
  const choice = defaultSessionChoice(db, teamId);
  if (choice === null) return null;
  const thinkingLevel =
    choice.reason === 'coordinator'
      ? (storedRuleRow(db, teamId, 'coordinator')?.thinkingLevel ?? null)
      : null;
  return { ...syntheticRule(teamId, 'session', choice), thinkingLevel };
}

function taskModelChoice(todoRow: RoutedTodo): ProjectModelChoice | null {
  const model = todoRow.request?.model;
  if (model === undefined) return null;
  return { provider: model.provider, modelId: model.modelId, thinkingLevel: model.thinkingLevel };
}

function syntheticRule(
  teamId: string,
  use: 'session' | 'coordinator',
  choice: { provider: string; modelId: string },
): RoutingRuleRow {
  return {
    id: use === 'session' ? DEFAULT_SESSION_RULE_ID : DEFAULT_COORDINATOR_RULE_ID,
    teamId,
    use,
    provider: choice.provider,
    modelId: choice.modelId,
    thinkingLevel: null,
    fallbackModels: null,
    machineId: null,
    requiredCapabilities: null,
    seededFromAgentId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function storedRouteForStep(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
): RoutingRuleRow | null {
  if (kind === 'review') return ruleRow(db, todoRow.teamId, 'review');
  if (!isSessionStepKind(kind) && kind !== 'merge') return null;
  return ruleRow(db, todoRow.teamId, 'session');
}

export function routeForStep(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
): RoutingRuleRow | null {
  const stored = storedRouteForStep(db, todoRow, kind);
  if (kind === 'review' || (!isSessionStepKind(kind) && kind !== 'merge')) return stored;
  const base = stored ?? defaultSessionRule(db, todoRow.teamId);
  const choice = taskModelChoice(todoRow);
  if (choice === null) return base;
  return { ...(base ?? syntheticRule(todoRow.teamId, 'session', choice)), ...choice };
}

export function projectModelChoice(
  db: Pick<Db, 'select'>,
  teamId: string,
  projectId: string | null,
  use: ProjectModelUse,
): ProjectModelChoice | null {
  if (projectId === null) return null;
  const row = db
    .select({ modelOverrides: project.modelOverrides })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  return row?.modelOverrides?.[use] ?? null;
}

function policyUse(kind: StepKind): 'session' | 'review' | null {
  if (isSessionStepKind(kind) || kind === 'merge') return 'session';
  return kind === 'review' ? 'review' : null;
}

export function policyForStep(
  db: Pick<Db, 'select'>,
  todoRow: Pick<RoutedTodo, 'teamId'>,
  kind: StepKind,
): WorkPolicyRow | null {
  const use = policyUse(kind);
  if (use === null) return null;
  return (
    db
      .select()
      .from(workPolicy)
      .where(and(eq(workPolicy.teamId, todoRow.teamId), eq(workPolicy.use, use)))
      .get() ?? null
  );
}

export function withOverride(
  rule: RequiredCapabilities | null,
  override: RequiredCapabilities | undefined,
): RequiredCapabilities | null {
  if (override === undefined) return rule;
  const union = (a: string[] | undefined, b: string[] | undefined) => {
    const all = [...new Set([...(a ?? []), ...(b ?? [])])];
    return all.length > 0 ? all : undefined;
  };
  const mcpServers = union(rule?.mcpServers, override.mcpServers);
  const models = union(rule?.models, override.models);
  const executor = rule?.executor ?? override.executor;
  const os = override.os ?? rule?.os;
  const merged: RequiredCapabilities = {
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(models !== undefined ? { models } : {}),
    ...(executor !== undefined ? { executor } : {}),
    ...(os !== undefined ? { os } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : rule;
}

export const PLATFORM_LOCKED_MESSAGE = '运行中不能改，换平台请新开任务';

export function assertPlatformUnlocked(db: Pick<Db, 'select'>, todoId: string): void {
  const started = db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .where(and(eq(build.todoId, todoId), isNotNull(step.sessionId)))
    .get();
  if (started !== undefined) throw new HttpError(409, PLATFORM_LOCKED_MESSAGE);
}

export function assertPlatformChangeAllowed(
  db: Pick<Db, 'select'>,
  todoRow: Pick<typeof todo.$inferSelect, 'id' | 'routeOverride'>,
  os: RunnerOs | null,
): boolean {
  if ((todoRow.routeOverride?.requiredCapabilities?.os ?? null) === os) return false;
  assertPlatformUnlocked(db, todoRow.id);
  return true;
}

export function setTodoPlatform(
  db: Db,
  todoRow: Pick<typeof todo.$inferSelect, 'id' | 'routeOverride' | 'v'>,
  os: RunnerOs | null,
): void {
  if (!assertPlatformChangeAllowed(db, todoRow, os)) return;
  db.update(todo)
    .set({ routeOverride: withPlatform(todoRow.routeOverride, os), v: todoRow.v + 1 })
    .where(eq(todo.id, todoRow.id))
    .run();
}

export function routeProfile(
  route: RoutingRuleRow,
  policy: WorkPolicyRow | null = null,
  override: RouteOverride | null = null,
): RouteProfile {
  const session = route.use === 'session';
  return {
    id: route.id,
    teamId: route.teamId,
    displayName: USE_DISPLAY_NAMES[route.use],
    description: null,
    provider: route.provider,
    modelId: route.modelId,
    thinkingLevel: route.thinkingLevel,
    machineId: (session ? override?.machineId : undefined) ?? route.machineId,
    tools: policy?.tools ?? [],
    secrets: policy?.secrets ?? [],
    defaultSkill: policy?.defaultSkill ?? null,
    skillsAllowlist: policy === null ? [] : policy.skillsAllowlist,
    requiredCapabilities: session
      ? withOverride(route.requiredCapabilities, override?.requiredCapabilities)
      : route.requiredCapabilities,
    fallbackModels: route.fallbackModels,
    routed: false,
  };
}

export function ruleProfileForStep(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
): RouteProfile | null {
  const route = routeForStep(db, todoRow, kind);
  if (route === null) return null;
  const profile = routeProfile(
    route,
    policyForStep(db, todoRow, kind),
    todoRow.routeOverride ?? null,
  );
  const os = profile.requiredCapabilities?.os;
  if (os === undefined || profile.machineId === null) return profile;
  const named = db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.id, profile.machineId))
    .get();
  return named !== undefined && runnerOsOf(named.capabilities) === os
    ? profile
    : { ...profile, machineId: null };
}

export function isAutoRoutedSessionRule(rule: {
  use?: RouteUse;
  provider: string | null;
  modelId: string | null;
}): boolean {
  if (rule.use !== undefined && rule.use !== 'session') return false;
  return (
    (rule.provider === DEFAULT_SESSION_PROVIDER && rule.modelId === DEFAULT_SESSION_MODEL) ||
    (rule.provider === CODEX_MODEL.provider && rule.modelId === CODEX_MODEL.modelId)
  );
}

export function profileForStep(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
  stepId: string | null = null,
): RouteProfile | null {
  const base = ruleProfileForStep(db, todoRow, kind);
  if (base === null) return null;
  const route = routeForStep(db, todoRow, kind);
  if (route?.use !== 'session' || !isSessionStepKind(kind)) return base;
  if (taskModelChoice(todoRow) !== null) return base;
  const sources = listConnectedTierSources(db, todoRow.teamId, base.provider, base.modelId);
  const stepProject =
    todoRow.projectId == null
      ? undefined
      : db
          .select({ repoKind: project.repoKind, githubRepo: project.githubRepo })
          .from(project)
          .where(and(eq(project.id, todoRow.projectId), eq(project.teamId, todoRow.teamId)))
          .get();
  const stepPrompt =
    stepId !== null && kind === 'verify'
      ? (db.select({ prompt: step.prompt }).from(step).where(eq(step.id, stepId)).get()?.prompt ??
        null)
      : null;
  const githubPushRepo = requiredGithubPushRepoForStep({
    project: stepProject,
    step: { kind, prompt: stepPrompt },
    todo: { output: todoRow.output ?? 'code' },
    agentTools: base.tools,
  });
  const decision = decideStepRoute(
    db,
    todoRow,
    kind,
    stepId,
    {
      machineId: base.machineId,
      required: base.requiredCapabilities,
    },
    {
      primaryProvider: base.provider,
      preferredModelId: base.modelId,
      githubPushRepo,
    },
  );
  const fallbacks =
    base.fallbackModels === null
      ? tierFallbackChain(sources, decision.difficulty, null)
      : base.fallbackModels;
  const fallbackModels = fallbacks.length > 0 ? fallbacks : base.fallbackModels;
  const primarySource =
    base.provider === null ? undefined : sources.find((s) => s.provider === base.provider);
  const uncataloguedCustomModel =
    primarySource !== undefined &&
    primarySource.runtime === 'pi' &&
    primarySource.tiers.ordered.length === 1 &&
    base.modelId !== null &&
    !primarySource.models.some((m) => m.id === base.modelId);
  if (decision.chosen === null || uncataloguedCustomModel) {
    return { ...base, fallbackModels };
  }
  if (
    base.provider !== null &&
    decision.chosen.provider !== base.provider &&
    primarySourceOnlyOffline(
      db,
      todoRow.teamId,
      base.provider,
      { machineId: base.machineId, required: base.requiredCapabilities },
      {
        preferredModelId: base.modelId,
        difficulty: decision.difficulty,
        githubPushRepo,
      },
    )
  ) {
    return { ...base, fallbackModels };
  }
  const primaryConnected =
    base.provider !== null && sources.some((source) => source.provider === base.provider);
  const switchedProvider = base.provider !== null && decision.chosen.provider !== base.provider;
  const isFallback = decision.fellBack === true || (switchedProvider && !primaryConnected);
  const fromRef =
    decision.fellBack === true && decision.desired != null
      ? decision.desired
      : base.provider !== null && base.modelId !== null
        ? { provider: base.provider, modelId: base.modelId }
        : null;
  const rejectWhy =
    fromRef === null
      ? undefined
      : decision.rejected.find((r) => r.modelId === fromRef.modelId)?.why;
  const switchReason =
    rejectWhy === 'quota'
      ? '额度达到上限'
      : rejectWhy === 'harness-missing'
        ? '执行机未安装对应运行环境'
        : !primaryConnected && base.provider !== null
          ? '服务商不可用'
          : rejectWhy === 'unavailable'
            ? '模型不可用'
            : decision.reason;
  const sameAsBase =
    decision.chosen.provider === base.provider && decision.chosen.modelId === base.modelId;
  return {
    ...base,
    provider: decision.chosen.provider,
    modelId: decision.chosen.modelId,
    thinkingLevel: sameAsBase ? base.thinkingLevel : null,
    fallbackModels,
    routed: true,
    ...(isFallback && fromRef !== null
      ? {
          switchedFrom: {
            provider: fromRef.provider,
            modelId: fromRef.modelId,
            reason: switchReason,
          },
        }
      : {}),
  };
}

export function providerRefusal(
  db: Pick<Db, 'select'>,
  teamId: string,
  providerId: string,
): 'rule-provider-missing' | 'rule-provider-has-no-key' | null {
  const row = db
    .select({ keyed: sql<number>`${provider.apiKeyCipher} is not null` })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  if (row === undefined) return 'rule-provider-missing';
  return row.keyed === 1 || keylessEndpoint(providerId) ? null : 'rule-provider-has-no-key';
}

export function withProjectCoordinatorModel<T extends RoutingRuleRow>(
  db: Pick<Db, 'select'>,
  rule: T,
  projectId: string | null,
): T {
  const choice = projectModelChoice(db, rule.teamId, projectId, 'coordinator');
  if (choice === null) return rule;
  if (
    stepRuntimeFor(choice.provider) === 'pi' &&
    choice.provider !== rule.provider &&
    providerRefusal(db, rule.teamId, choice.provider) !== null
  ) {
    return rule;
  }
  return { ...rule, ...choice };
}

export function coordinatorProfile(
  db: Pick<Db, 'select'>,
  teamId: string,
  projectId: string | null = null,
): RouteProfile | null {
  const route =
    ruleRow(db, teamId, 'coordinator') ??
    (coordinatorRunsOnPi() ? defaultCoordinatorRule(db, teamId) : null);
  if (route === null) return null;
  const resolved = withProjectCoordinatorModel(db, route, projectId);
  const profile = routeProfile(resolved);
  const override = projectModelChoice(db, teamId, projectId, 'coordinator');
  if (
    override !== null &&
    resolved === route &&
    stepRuntimeFor(override.provider) === 'pi' &&
    override.provider !== route.provider
  ) {
    const refusal = providerRefusal(db, teamId, override.provider);
    if (refusal !== null) {
      return {
        ...profile,
        switchedFrom: {
          provider: override.provider,
          modelId: override.modelId,
          reason: refusal === 'rule-provider-has-no-key' ? '未配置密钥' : '服务商不可用',
        },
      };
    }
  }
  return profile;
}

export function coordinatorMemoryOwner(db: Pick<Db, 'select'>, teamId: string): string | undefined {
  const stored = storedRuleRow(db, teamId, 'coordinator');
  if (stored !== null) return stored.id;
  if (!coordinatorRunsOnPi() || defaultCoordinatorRule(db, teamId) === null) return undefined;
  return db.select({ id: chief.id }).from(chief).where(eq(chief.teamId, teamId)).get()?.id;
}

export const VERIFY_MEMORY_OWNER_SUFFIX = ':verify';

export function memoryOwnerOf(db: Pick<Db, 'select'>, teamId: string, kind: StepKind): string {
  const route = storedRouteForStep(db, { teamId }, kind) ?? storedRuleRow(db, teamId, 'session');
  const owner = route?.id ?? teamId;
  return kind === 'verify' ? `${owner}${VERIFY_MEMORY_OWNER_SUFFIX}` : owner;
}

export function memoryOpsAreTeamScoped(kind: StepKind): boolean {
  return kind !== 'review' && kind !== 'verify';
}

function toRoutingRuleRecord(row: RoutingRuleRow): RoutingRuleRecord {
  return {
    id: row.id,
    teamId: row.teamId,
    use: row.use,
    provider: row.provider,
    modelId: row.modelId,
    thinkingLevel: row.thinkingLevel,
    fallbackModels: row.fallbackModels,
    machineId: row.machineId,
    requiredCapabilities: row.requiredCapabilities,
    seededFromAgentId: row.seededFromAgentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toWorkPolicyRecord(row: WorkPolicyRow): WorkPolicyRecord {
  return {
    id: row.id,
    teamId: row.teamId,
    use: row.use,
    tools: row.tools,
    skillsAllowlist: row.skillsAllowlist,
    defaultSkill: row.defaultSkill,
    secrets: row.secrets,
    seededFromAgentId: row.seededFromAgentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requireRoutingRule(db: Db, id: string): RoutingRuleRecord {
  const row = db.select().from(routingRule).where(eq(routingRule.id, id)).get();
  if (row === undefined) throw notFound(`routing_rule ${id}`);
  return toRoutingRuleRecord(row);
}

function requireWorkPolicy(db: Db, id: string): WorkPolicyRecord {
  const row = db.select().from(workPolicy).where(eq(workPolicy.id, id)).get();
  if (row === undefined) throw notFound(`work_policy ${id}`);
  return toWorkPolicyRecord(row);
}

export function listRoutingSettings(
  db: Db,
  teamId: string,
  coordinatorInServer = false,
): TeamRoutingSettings {
  const rules = db
    .select()
    .from(routingRule)
    .where(eq(routingRule.teamId, teamId))
    .all()
    .filter((row) => ROUTE_USES.includes(row.use))
    .map(toRoutingRuleRecord)
    .sort((a, b) => a.use.localeCompare(b.use));
  const policies = db
    .select()
    .from(workPolicy)
    .where(eq(workPolicy.teamId, teamId))
    .all()
    .map(toWorkPolicyRecord)
    .sort((a, b) => a.use.localeCompare(b.use));
  const none = { reason: 'none' as const, provider: null, modelId: null };
  return {
    rules,
    policies,
    ...(rules.some((rule) => rule.use === 'session')
      ? {}
      : { sessionDefault: defaultSessionChoice(db, teamId) ?? none }),
    ...(!coordinatorInServer || rules.some((rule) => rule.use === 'coordinator')
      ? {}
      : { coordinatorDefault: defaultCoordinatorChoice(db, teamId) ?? none }),
  };
}

function requireTeamMachine(db: Db, teamId: string, machineId: string): void {
  const row = db
    .select({ id: machine.id })
    .from(machine)
    .where(and(eq(machine.id, machineId), eq(machine.teamId, teamId)))
    .get();
  if (row === undefined) throw notFound(`machine ${machineId}`);
}

export function upsertRoutingRule(
  db: Db,
  teamId: string,
  use: RouteUse,
  body: PatchRoutingRuleBody,
): RoutingRuleRecord {
  return db.transaction(() => {
    const saved = writeRoutingRule(db, teamId, use, body);
    if (use === 'coordinator') taskRuleFollowsCoordinator(db, saved);
    return saved;
  });
}

function taskRuleFollowsCoordinator(db: Db, coordinator: RoutingRuleRecord): void {
  db.update(routingRule)
    .set({
      provider: coordinator.provider,
      modelId: coordinator.modelId,
      thinkingLevel: coordinator.thinkingLevel,
      updatedAt: nowMs(),
    })
    .where(
      and(
        eq(routingRule.teamId, coordinator.teamId),
        eq(routingRule.use, 'session'),
        or(
          ne(routingRule.provider, coordinator.provider),
          ne(routingRule.modelId, coordinator.modelId),
          sql`${routingRule.thinkingLevel} is not ${coordinator.thinkingLevel}`,
        ),
      ),
    )
    .run();
}

function writeRoutingRule(
  db: Db,
  teamId: string,
  use: RouteUse,
  body: PatchRoutingRuleBody,
): RoutingRuleRecord {
  const existing = db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, use)))
    .get();
  if (body.expectedUpdatedAt !== undefined && existing?.updatedAt !== body.expectedUpdatedAt) {
    throw new HttpError(409, 'routing rule changed since it was read');
  }
  if (body.machineId != null) requireTeamMachine(db, teamId, body.machineId);
  const now = nowMs();
  if (existing === undefined) {
    const fallback =
      use === 'session' && body.provider === undefined && body.modelId === undefined
        ? defaultSessionChoice(db, teamId)
        : null;
    const created = {
      provider: body.provider ?? fallback?.provider,
      modelId: body.modelId ?? fallback?.modelId,
    };
    if (created.provider === undefined || created.modelId === undefined) {
      throw new HttpError(400, 'provider and modelId are required to create a routing rule');
    }
    const id = newRecordId();
    db.insert(routingRule)
      .values({
        id,
        teamId,
        use,
        provider: created.provider,
        modelId: created.modelId,
        thinkingLevel: body.thinkingLevel ?? null,
        fallbackModels: body.fallbackModels ?? null,
        machineId: body.machineId ?? null,
        requiredCapabilities: body.requiredCapabilities ?? null,
        seededFromAgentId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return requireRoutingRule(db, id);
  }
  const sets: Partial<RoutingRuleRow> = { updatedAt: now };
  if (body.provider !== undefined) sets.provider = body.provider;
  if (body.modelId !== undefined) sets.modelId = body.modelId;
  if (body.thinkingLevel !== undefined) sets.thinkingLevel = body.thinkingLevel;
  if (body.fallbackModels !== undefined) sets.fallbackModels = body.fallbackModels;
  if (body.machineId !== undefined) sets.machineId = body.machineId;
  if (body.requiredCapabilities !== undefined) {
    sets.requiredCapabilities = body.requiredCapabilities;
  }
  db.update(routingRule).set(sets).where(eq(routingRule.id, existing.id)).run();
  return requireRoutingRule(db, existing.id);
}

export function seedClaudeCodeRules(db: Db, teamId: string): void {
  const stored = new Set(
    db
      .select({ use: routingRule.use })
      .from(routingRule)
      .where(eq(routingRule.teamId, teamId))
      .all()
      .map((row) => row.use),
  );
  const coordinator = defaultCoordinatorChoice(db, teamId);
  if (!stored.has('coordinator') && coordinator?.reason === 'claude-code') {
    const machines = db
      .select({
        id: machine.id,
        online: machine.online,
        claudeCodeReport: machine.claudeCodeReport,
        capabilities: machine.capabilities,
      })
      .from(machine)
      .where(eq(machine.teamId, teamId))
      .orderBy(asc(machine.id))
      .all();
    const capable = machines.filter((row) => machineRuntimeAvailable(row, 'claude-code'));
    const home =
      machines.length > 1 ? (capable.find((row) => row.online) ?? capable[0]) : undefined;
    upsertRoutingRule(db, teamId, 'coordinator', {
      provider: coordinator.provider,
      modelId: coordinator.modelId,
      ...(home !== undefined ? { machineId: home.id } : {}),
    });
  }
}

export function upsertWorkPolicy(
  db: Db,
  teamId: string,
  use: PolicyUse,
  body: PatchWorkPolicyBody,
): WorkPolicyRecord {
  const existing = db
    .select()
    .from(workPolicy)
    .where(and(eq(workPolicy.teamId, teamId), eq(workPolicy.use, use)))
    .get();
  const now = nowMs();
  if (existing === undefined) {
    const id = newRecordId();
    db.insert(workPolicy)
      .values({
        id,
        teamId,
        use,
        tools: filterAgentTools(body.tools ?? []),
        mcpServers: [],
        skillsAllowlist: body.skillsAllowlist ?? null,
        defaultSkill: body.defaultSkill ?? null,
        secrets: body.secrets ?? [],
        seededFromAgentId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return requireWorkPolicy(db, id);
  }
  const sets: Partial<WorkPolicyRow> = { updatedAt: now };
  if (body.tools !== undefined) sets.tools = filterAgentTools(body.tools);
  if (body.skillsAllowlist !== undefined) sets.skillsAllowlist = body.skillsAllowlist;
  if (body.defaultSkill !== undefined) sets.defaultSkill = body.defaultSkill;
  if (body.secrets !== undefined) sets.secrets = body.secrets;
  db.update(workPolicy).set(sets).where(eq(workPolicy.id, existing.id)).run();
  return requireWorkPolicy(db, existing.id);
}

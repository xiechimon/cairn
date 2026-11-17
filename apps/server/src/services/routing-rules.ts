import {
  CODEX_MODEL,
  type CoordinatorDefault,
  filterAgentTools,
  isSessionStepKind,
  type PatchRoutingRuleBody,
  type PatchWorkPolicyBody,
  type PolicyUse,
  PROVIDER_PRESET_IDS,
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
  type TeamRoutingSettings,
  type TodoSourceKind,
  type WorkPolicyRecord,
  withPlatform,
} from '@cairn/shared';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { builtinModelIds, isBuiltinProvider } from '../coordinator/runtime/provider.js';
import type { Db } from '../db/client.js';
import {
  build,
  chief,
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
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { coordinatorToolDefs } from './coordinator-tool-defs.js';
import { claudeCodeUsable, machineRuntimeAvailable } from './dispatch-eligibility.js';
import { DEFAULT_SESSION_MODEL, DEFAULT_SESSION_PROVIDER } from './routing-migration.js';
import { decideStepRoute } from './step-route.js';

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
}

export interface RoutedTodo {
  teamId: string;
  projectId?: string | null;
  sourceKind?: TodoSourceKind | null;
  sourceRef?: string | null;
  routeOverride?: RouteOverride | null;
}

const USE_DISPLAY_NAMES: Record<RouteUse, string> = {
  coordinator: 'Coordinator',
  session: 'Session',
  review: 'Reviewer',
  digest: 'Digest',
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

export function keylessEndpoint(providerId: string): boolean {
  const presets: readonly string[] = PROVIDER_PRESET_IDS;
  return !presets.includes(providerId) && !isBuiltinProvider(providerId);
}

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

export function defaultSessionChoice(
  db: Pick<Db, 'select'>,
  teamId: string,
): (SessionDefault & { provider: string; modelId: string }) | null {
  if (claudeCodeUsable(db, teamId)) {
    return {
      reason: 'claude-code',
      provider: DEFAULT_SESSION_PROVIDER,
      modelId: DEFAULT_SESSION_MODEL,
    };
  }
  const choice = providerSessionChoice(db, teamId);
  return choice === null ? null : { reason: 'provider', ...choice };
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
  return claudeCodeUsable(db, teamId)
    ? { reason: 'claude-code', provider: 'claude-code', modelId: CLAUDE_CODE_COORDINATOR_MODEL }
    : null;
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
  return choice === null ? null : syntheticRule(teamId, 'session', choice);
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
    tools: null,
    mcpServers: null,
    skillsAllowlist: null,
    defaultSkill: null,
    secrets: null,
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
  const choice = projectModelChoice(db, todoRow.projectId ?? null, 'session');
  if (choice === null) return base;
  return { ...(base ?? syntheticRule(todoRow.teamId, 'session', choice)), ...choice };
}

export function projectModelChoice(
  db: Pick<Db, 'select'>,
  projectId: string | null,
  use: ProjectModelUse,
): ProjectModelChoice | null {
  if (projectId === null) return null;
  const row = db
    .select({ modelOverrides: project.modelOverrides })
    .from(project)
    .where(eq(project.id, projectId))
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

export const ROUTED_PROVIDERS = ['claude-code', CODEX_MODEL.provider];

export function profileForStep(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
  stepId: string | null = null,
): RouteProfile | null {
  const base = ruleProfileForStep(db, todoRow, kind);
  if (base === null) return null;
  const route = routeForStep(db, todoRow, kind);
  if (route?.use !== 'session') return base;
  if (base.provider === null || !ROUTED_PROVIDERS.includes(base.provider)) return base;
  const decision = decideStepRoute(db, todoRow, kind, stepId, {
    machineId: base.machineId,
    required: base.requiredCapabilities,
  });
  if (decision.chosen === null) {
    const stockSeed =
      base.provider === DEFAULT_SESSION_PROVIDER && base.modelId === DEFAULT_SESSION_MODEL;
    const choice =
      stockSeed && !claudeCodeUsable(db, todoRow.teamId)
        ? providerSessionChoice(db, todoRow.teamId)
        : null;
    return choice === null ? base : { ...base, ...choice };
  }
  return {
    ...base,
    provider: decision.chosen.provider,
    modelId: decision.chosen.modelId,
    routed: true,
  };
}

export function coordinatorProfile(db: Pick<Db, 'select'>, teamId: string): RouteProfile | null {
  const route =
    ruleRow(db, teamId, 'coordinator') ??
    (coordinatorRunsOnPi() ? defaultCoordinatorRule(db, teamId) : null);
  return route === null ? null : routeProfile(route);
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
        tools: null,
        mcpServers: null,
        skillsAllowlist: null,
        defaultSkill: null,
        secrets: null,
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
  const session = defaultSessionChoice(db, teamId);
  if (!stored.has('session') && session?.reason === 'claude-code') {
    upsertRoutingRule(db, teamId, 'session', {
      provider: session.provider,
      modelId: session.modelId,
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

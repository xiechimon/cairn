import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_REPLY_TOOLS,
  CHIEF_ROUTER_TOOLS,
  CODEX_MODEL,
  filterAgentTools,
  isSessionStepKind,
  type PatchRoutingRuleBody,
  type PatchWorkPolicyBody,
  type PolicyUse,
  type RemoteToolDef,
  type RequiredCapabilities,
  type RouteOverride,
  type RouteUse,
  type RoutingRuleRecord,
  type RunnerOs,
  runnerOsOf,
  type StepKind,
  type TeamRoutingSettings,
  type TodoSourceKind,
  type WorkPolicyRecord,
  withPlatform,
} from '@cairn/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, machine, routingRule, step, todo, workPolicy } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
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
  mcpServers: string[];
  requiredCapabilities: RequiredCapabilities | null;
  fallbackModels: RoutingRuleRow['fallbackModels'];
  routed: boolean;
}

export interface RoutedTodo {
  teamId: string;
  sourceKind?: TodoSourceKind | null;
  routeOverride?: RouteOverride | null;
}

const USE_DISPLAY_NAMES: Record<RouteUse, string> = {
  coordinator: 'Coordinator',
  session: 'Session',
  review: 'Reviewer',
  digest: 'Digest',
  compaction: 'Compaction',
  citation_check: 'Citation checker',
};

export function chiefRemoteTools(): readonly RemoteToolDef[] {
  return [...CHIEF_REMOTE_TOOLS, ...CHIEF_ROUTER_TOOLS, ...CHIEF_REPLY_TOOLS];
}

function ruleRow(db: Pick<Db, 'select'>, teamId: string, use: RouteUse): RoutingRuleRow | null {
  return (
    db
      .select()
      .from(routingRule)
      .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, use)))
      .get() ?? null
  );
}

export function routeForStep(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
): RoutingRuleRow | null {
  if (kind === 'review') return ruleRow(db, todoRow.teamId, 'review');
  if (!isSessionStepKind(kind) && kind !== 'merge') return null;
  if (todoRow.sourceKind === 'research-citation-check') {
    const checker = ruleRow(db, todoRow.teamId, 'citation_check');
    if (checker !== null) return checker;
  }
  return ruleRow(db, todoRow.teamId, 'session');
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

export function setTodoPlatform(
  db: Db,
  todoRow: Pick<typeof todo.$inferSelect, 'id' | 'routeOverride' | 'v'>,
  os: RunnerOs | null,
): void {
  if ((todoRow.routeOverride?.requiredCapabilities?.os ?? null) === os) return;
  assertPlatformUnlocked(db, todoRow.id);
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
    mcpServers: route.use === 'coordinator' ? (route.mcpServers ?? []) : (policy?.mcpServers ?? []),
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

const ROUTED_PROVIDERS = ['claude-code', CODEX_MODEL.provider];

export function profileForStep(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
  stepId: string | null = null,
): RouteProfile | null {
  const base = ruleProfileForStep(db, todoRow, kind);
  if (base === null) return null;
  const route = routeForStep(db, todoRow, kind);
  if (route?.use !== 'session' || todoRow.sourceKind === 'research-citation-check') return base;
  if (base.provider === null || !ROUTED_PROVIDERS.includes(base.provider)) return base;
  const decision = decideStepRoute(db, todoRow, kind, stepId, {
    machineId: base.machineId,
    required: base.requiredCapabilities,
  });
  if (decision.chosen === null) return base;
  return {
    ...base,
    provider: decision.chosen.provider,
    modelId: decision.chosen.modelId,
    routed: true,
  };
}

export function coordinatorProfile(db: Pick<Db, 'select'>, teamId: string): RouteProfile | null {
  const route = ruleRow(db, teamId, 'coordinator');
  return route === null ? null : routeProfile(route);
}

export const VERIFY_MEMORY_OWNER_SUFFIX = ':verify';

export function memoryOwnerOf(db: Pick<Db, 'select'>, teamId: string, kind: StepKind): string {
  const route = routeForStep(db, { teamId }, kind) ?? ruleRow(db, teamId, 'session');
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
    mcpServers: row.mcpServers,
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

export function listRoutingSettings(db: Db, teamId: string): TeamRoutingSettings {
  const rules = db
    .select()
    .from(routingRule)
    .where(eq(routingRule.teamId, teamId))
    .all()
    .map(toRoutingRuleRecord)
    .sort((a, b) => a.use.localeCompare(b.use));
  const policies = db
    .select()
    .from(workPolicy)
    .where(eq(workPolicy.teamId, teamId))
    .all()
    .map(toWorkPolicyRecord)
    .sort((a, b) => a.use.localeCompare(b.use));
  return { rules, policies };
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
  if (body.machineId != null) requireTeamMachine(db, teamId, body.machineId);
  const now = nowMs();
  if (existing === undefined) {
    if (body.provider === undefined || body.modelId === undefined) {
      throw new HttpError(400, 'provider and modelId are required to create a routing rule');
    }
    const id = newRecordId();
    db.insert(routingRule)
      .values({
        id,
        teamId,
        use,
        provider: body.provider,
        modelId: body.modelId,
        thinkingLevel: body.thinkingLevel ?? null,
        fallbackModels: body.fallbackModels ?? null,
        machineId: body.machineId ?? null,
        requiredCapabilities: body.requiredCapabilities ?? null,
        tools: null,
        mcpServers: body.mcpServers ?? null,
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
  if (body.mcpServers !== undefined) sets.mcpServers = body.mcpServers;
  db.update(routingRule).set(sets).where(eq(routingRule.id, existing.id)).run();
  return requireRoutingRule(db, existing.id);
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
        mcpServers: body.mcpServers ?? [],
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
  if (body.mcpServers !== undefined) sets.mcpServers = body.mcpServers;
  if (body.skillsAllowlist !== undefined) sets.skillsAllowlist = body.skillsAllowlist;
  if (body.defaultSkill !== undefined) sets.defaultSkill = body.defaultSkill;
  if (body.secrets !== undefined) sets.secrets = body.secrets;
  db.update(workPolicy).set(sets).where(eq(workPolicy.id, existing.id)).run();
  return requireWorkPolicy(db, existing.id);
}

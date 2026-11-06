import { createHash } from 'node:crypto';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  AGENT_TOOL_TAG,
  CHIEF_REMOTE_TOOLS,
  CHIEF_ROUTER_TOOLS,
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
  type StepKind,
  type TeamRoutingSettings,
  type WorkPolicyRecord,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  agentMemory,
  chief,
  machine,
  routingRule,
  team,
  todo,
  workPolicy,
} from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { modelsAreIndependent } from './merge-gate/model-identity.js';

type AgentRow = typeof agent.$inferSelect;
type RoutingRuleRow = typeof routingRule.$inferSelect;
type WorkPolicyRow = typeof workPolicy.$inferSelect;

const REVIEWER_DENIED_TOOLS: readonly string[] = [
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_TAG,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
];

let routingRulesOn = false;

export function setRoutingRulesEnabled(on: boolean): void {
  routingRulesOn = on;
}

export function routingRulesEnabled(): boolean {
  return routingRulesOn;
}

export function chiefRemoteTools(): readonly RemoteToolDef[] {
  return routingRulesOn ? [...CHIEF_REMOTE_TOOLS, ...CHIEF_ROUTER_TOOLS] : CHIEF_REMOTE_TOOLS;
}

export function routeForStep(
  db: Db,
  todoRow: Pick<typeof todo.$inferSelect, 'teamId'>,
  kind: StepKind,
): RoutingRuleRow | null {
  if (!routingRulesOn) return null;
  const use =
    isSessionStepKind(kind) || kind === 'merge' ? 'session' : kind === 'review' ? 'review' : null;
  if (use === null) return null;
  return (
    db
      .select()
      .from(routingRule)
      .where(and(eq(routingRule.teamId, todoRow.teamId), eq(routingRule.use, use)))
      .get() ?? null
  );
}

function policyUse(kind: StepKind): 'session' | 'review' | null {
  if (isSessionStepKind(kind) || kind === 'merge') return 'session';
  return kind === 'review' ? 'review' : null;
}

export function policyForStep(
  db: Pick<Db, 'select'>,
  todoRow: Pick<typeof todo.$inferSelect, 'teamId'>,
  kind: StepKind,
): WorkPolicyRow | null {
  if (!routingRulesOn) return null;
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

export function ruleAgent(route: RoutingRuleRow, policy: WorkPolicyRow | null = null): AgentRow {
  return {
    id: route.id,
    teamId: route.teamId,
    displayName: route.use === 'review' ? 'Reviewer' : 'Session',
    description: null,
    status: 'active',
    avatarUrl: null,
    provider: route.provider,
    modelId: route.modelId,
    thinkingLevel: route.thinkingLevel,
    persona: null,
    machineId: route.machineId,
    tools: policy?.tools ?? [],
    secrets: policy?.secrets ?? [],
    defaultSkill: policy?.defaultSkill ?? null,
    skillsAllowlist: policy?.skillsAllowlist ?? [],
    mcpServers: policy?.mcpServers ?? [],
    maxConcurrentTasks: null,
    requiredCapabilities: route.requiredCapabilities,
    fallbackModels: route.fallbackModels,
  };
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
  const merged: RequiredCapabilities = {
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(models !== undefined ? { models } : {}),
    ...(executor !== undefined ? { executor } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : rule;
}

export function applyPolicy(agentRow: AgentRow, policy: WorkPolicyRow | null): AgentRow {
  if (policy === null) return agentRow;
  return {
    ...agentRow,
    tools: policy.tools,
    mcpServers: policy.mcpServers,
    skillsAllowlist: policy.skillsAllowlist,
    defaultSkill: policy.defaultSkill,
    secrets: policy.secrets,
  };
}

export function applyRoute(
  agentRow: AgentRow,
  route: RoutingRuleRow | null,
  override: RouteOverride | null = null,
  policy: WorkPolicyRow | null = null,
): AgentRow {
  const policed = applyPolicy(agentRow, policy);
  if (route === null) return policed;
  const session = route.use === 'session';
  const owned = session || route.use === 'review';
  return {
    ...policed,
    provider: route.provider,
    modelId: route.modelId,
    thinkingLevel: route.thinkingLevel,
    fallbackModels: route.fallbackModels,
    machineId: (session ? override?.machineId : undefined) ?? route.machineId ?? agentRow.machineId,
    requiredCapabilities: session
      ? withOverride(route.requiredCapabilities, override?.requiredCapabilities)
      : owned
        ? route.requiredCapabilities
        : agentRow.requiredCapabilities,
  };
}

function sessionSeedAgent(db: Db, teamId: string): AgentRow | null {
  const teamAgents = db
    .select()
    .from(agent)
    .where(eq(agent.teamId, teamId))
    .all()
    .filter((row) => row.provider !== null && row.modelId !== null);
  const implementer = teamAgents.find((row) => row.persona === 'implementer');
  if (implementer !== undefined) return implementer;
  const buildCounts = new Map<string, number>();
  for (const { assignment } of db
    .select({ assignment: todo.assignment })
    .from(todo)
    .where(eq(todo.teamId, teamId))
    .all()) {
    const agentId = assignment?.build?.agentId;
    if (agentId == null) continue;
    buildCounts.set(agentId, (buildCounts.get(agentId) ?? 0) + 1);
  }
  let best: AgentRow | null = null;
  let bestCount = 0;
  for (const row of teamAgents) {
    const count = buildCounts.get(row.id) ?? 0;
    if (count > bestCount) {
      best = row;
      bestCount = count;
    }
  }
  return best;
}

function seededRequirement(db: Db, source: AgentRow): RequiredCapabilities | null {
  const seedMachine =
    source.machineId === null
      ? undefined
      : db.select().from(machine).where(eq(machine.id, source.machineId)).get();
  const orb =
    seedMachine !== undefined &&
    (seedMachine.capabilities?.executor === 'orb' ||
      (seedMachine.capabilities?.executor === undefined && seedMachine.name.endsWith('-orb')));
  const own = source.requiredCapabilities ?? null;
  if (!orb) return own;
  return { ...(own ?? {}), executor: 'orb' };
}

function seedRule(db: Db, teamId: string, use: 'session' | 'review', source: AgentRow): number {
  if (source.provider == null || source.modelId == null) return 0;
  const now = nowMs();
  return db
    .insert(routingRule)
    .values({
      id: newRecordId(),
      teamId,
      use,
      provider: source.provider,
      modelId: source.modelId,
      thinkingLevel: source.thinkingLevel,
      fallbackModels: source.fallbackModels,
      machineId: source.machineId,
      requiredCapabilities: seededRequirement(db, source),
      seededFromAgentId: source.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run().changes;
}

function seedPolicy(db: Db, teamId: string, use: 'session' | 'review', source: AgentRow): number {
  const reviewer = use === 'review';
  const now = nowMs();
  return db
    .insert(workPolicy)
    .values({
      id: newRecordId(),
      teamId,
      use,
      tools: reviewer
        ? source.tools.filter((tool) => !REVIEWER_DENIED_TOOLS.includes(tool))
        : source.tools,
      mcpServers: source.mcpServers,
      skillsAllowlist: source.skillsAllowlist,
      defaultSkill: source.defaultSkill,
      secrets: reviewer ? [] : source.secrets,
      seededFromAgentId: source.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run().changes;
}

function ruleExists(db: Db, teamId: string, use: 'session' | 'review'): boolean {
  return (
    db
      .select({ id: routingRule.id })
      .from(routingRule)
      .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, use)))
      .get() !== undefined
  );
}

function backfillRuleConstraints(db: Db): void {
  for (const rule of db.select().from(routingRule).all()) {
    if (rule.requiredCapabilities !== null || rule.seededFromAgentId === null) continue;
    if (rule.use !== 'session' && rule.use !== 'review') continue;
    const source = db
      .select()
      .from(agent)
      .where(and(eq(agent.id, rule.seededFromAgentId), eq(agent.teamId, rule.teamId)))
      .get();
    if (source === undefined) continue;
    const required = seededRequirement(db, source);
    if (required === null) continue;
    db.update(routingRule)
      .set({ requiredCapabilities: required })
      .where(eq(routingRule.id, rule.id))
      .run();
  }
}

export function seedRoutingRules(db: Db): number {
  backfillRuleConstraints(db);
  let inserted = 0;
  for (const { id: teamId } of db.select({ id: team.id }).from(team).all()) {
    if (ruleExists(db, teamId, 'session')) continue;
    const source = sessionSeedAgent(db, teamId);
    if (source !== null) inserted += seedRule(db, teamId, 'session', source);
  }
  return inserted;
}

export function seedWorkPolicies(db: Db): number {
  let inserted = 0;
  for (const rule of db.select().from(routingRule).all()) {
    if (rule.use !== 'session' && rule.use !== 'review') continue;
    if (rule.seededFromAgentId === null) continue;
    const exists =
      db
        .select({ id: workPolicy.id })
        .from(workPolicy)
        .where(and(eq(workPolicy.teamId, rule.teamId), eq(workPolicy.use, rule.use)))
        .get() !== undefined;
    if (exists) continue;
    const source = db
      .select()
      .from(agent)
      .where(and(eq(agent.id, rule.seededFromAgentId), eq(agent.teamId, rule.teamId)))
      .get();
    if (source !== undefined) inserted += seedPolicy(db, rule.teamId, rule.use, source);
  }
  return inserted;
}

export function seedReviewPolicies(db: Db): number {
  let inserted = 0;
  for (const { id: teamId } of db.select({ id: team.id }).from(team).all()) {
    const exists =
      db
        .select({ id: workPolicy.id })
        .from(workPolicy)
        .where(and(eq(workPolicy.teamId, teamId), eq(workPolicy.use, 'review')))
        .get() !== undefined;
    if (exists) continue;
    const reviewer = db
      .select()
      .from(agent)
      .where(and(eq(agent.teamId, teamId), eq(agent.persona, 'code_reviewer')))
      .get();
    if (reviewer !== undefined) {
      inserted += seedPolicy(db, teamId, 'review', reviewer);
      continue;
    }
    const now = nowMs();
    inserted += db
      .insert(workPolicy)
      .values({
        id: newRecordId(),
        teamId,
        use: 'review',
        tools: [],
        mcpServers: [],
        skillsAllowlist: null,
        defaultSkill: null,
        secrets: [],
        seededFromAgentId: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run().changes;
  }
  return inserted;
}

export function seedReviewRules(db: Db): number {
  let inserted = 0;
  for (const { id: teamId } of db.select({ id: team.id }).from(team).all()) {
    if (ruleExists(db, teamId, 'review')) continue;
    const reviewer = db
      .select()
      .from(agent)
      .where(and(eq(agent.teamId, teamId), eq(agent.persona, 'code_reviewer')))
      .get();
    if (reviewer === undefined) continue;
    const sessionModel = sessionRuleOf(db, teamId)?.modelId;
    if (sessionModel !== undefined && !modelsAreIndependent(sessionModel, reviewer.modelId ?? '')) {
      continue;
    }
    inserted += seedRule(db, teamId, 'review', reviewer);
  }
  return inserted;
}

function sessionRuleOf(db: Pick<Db, 'select'>, teamId: string): RoutingRuleRow | undefined {
  return db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'session')))
    .get();
}

export function memoryOwnerOf(
  db: Pick<Db, 'select'>,
  teamId: string,
  agentId: string,
  kind: StepKind,
): string {
  if (!routingRulesOn || !isSessionStepKind(kind)) return agentId;
  const rule = sessionRuleOf(db, teamId);
  return rule?.adoptedAgentIds?.includes(agentId) ? rule.id : agentId;
}

export function memoryOpsAreTeamScoped(kind: StepKind): boolean {
  return kind !== 'review' && kind !== 'verify';
}

export function memoryInjectTeamId(kind: StepKind, teamId: string): string | undefined {
  return memoryOpsAreTeamScoped(kind) ? teamId : undefined;
}

function sessionAgentIds(db: Db, rule: RoutingRuleRow): string[] {
  const chiefAgents = new Set(
    db
      .select({ agentId: chief.agentId })
      .from(chief)
      .where(eq(chief.teamId, rule.teamId))
      .all()
      .map((row) => row.agentId)
      .filter((id): id is string => id !== null),
  );
  const ids = new Set<string>();
  if (rule.seededFromAgentId !== null) ids.add(rule.seededFromAgentId);
  for (const { assignment } of db
    .select({ assignment: todo.assignment })
    .from(todo)
    .where(eq(todo.teamId, rule.teamId))
    .all()) {
    for (const slot of [assignment?.plan, assignment?.build, assignment?.verify]) {
      if (slot?.agentId != null) ids.add(slot.agentId);
    }
  }
  return [...ids].filter((id) => !chiefAgents.has(id)).sort();
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
  return { enabled: routingRulesOn, rules, policies };
}

export function seedRoutingSettings(db: Db, teamId: string): TeamRoutingSettings {
  const teamRow = db.select({ id: team.id }).from(team).where(eq(team.id, teamId)).get();
  if (teamRow === undefined) throw notFound(`team ${teamId}`);
  seedRoutingRules(db);
  seedReviewRules(db);
  seedWorkPolicies(db);
  return listRoutingSettings(db, teamId);
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
        mcpServers: null,
        skillsAllowlist: null,
        defaultSkill: null,
        secrets: null,
        adoptedAgentIds: null,
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

export function adoptAgentMemories(db: Db): number {
  let copied = 0;
  for (const rule of db.select().from(routingRule).where(eq(routingRule.use, 'session')).all()) {
    const already = new Set(rule.adoptedAgentIds ?? []);
    const adopted = sessionAgentIds(db, rule);
    const fresh = adopted.filter((id) => !already.has(id));
    db.transaction((tx) => {
      const held = new Set(
        tx
          .select({ projectId: agentMemory.projectId, content: agentMemory.content })
          .from(agentMemory)
          .where(and(eq(agentMemory.agentId, rule.id), isNull(agentMemory.invalidAt)))
          .all()
          .map((row) => `${row.projectId ?? ''}\u0000${row.content}`),
      );
      for (const agentId of fresh) {
        const rows = tx
          .select()
          .from(agentMemory)
          .where(
            and(
              eq(agentMemory.agentId, agentId),
              eq(agentMemory.teamId, rule.teamId),
              isNull(agentMemory.invalidAt),
            ),
          )
          .all();
        for (const row of rows) {
          const key = `${row.projectId ?? ''}\u0000${row.content}`;
          if (held.has(key)) continue;
          held.add(key);
          const res = tx
            .insert(agentMemory)
            .values({
              ...row,
              id: createHash('sha256')
                .update(JSON.stringify(['adopt', rule.id, row.id]))
                .digest('hex'),
              agentId: rule.id,
              adoptedFrom: row.id,
              supersededBy: null,
              lastInjectedAt: null,
            })
            .onConflictDoNothing()
            .run();
          copied += res.changes;
        }
      }
      const unmarked = tx
        .select({ id: agentMemory.id })
        .from(agentMemory)
        .where(and(eq(agentMemory.teamId, rule.teamId), isNull(agentMemory.adoptedFrom)))
        .all();
      for (const orig of unmarked) {
        const seen = new Set<string>();
        let id: string | null = createHash('sha256')
          .update(JSON.stringify(['adopt', rule.id, orig.id]))
          .digest('hex');
        while (id !== null && !seen.has(id)) {
          seen.add(id);
          const row = tx.select().from(agentMemory).where(eq(agentMemory.id, id)).get();
          if (row === undefined) break;
          if (row.adoptedFrom === null) {
            tx.update(agentMemory)
              .set({ adoptedFrom: orig.id })
              .where(eq(agentMemory.id, row.id))
              .run();
          }
          id = row.supersededBy;
        }
      }
      const union = [...new Set([...(rule.adoptedAgentIds ?? []), ...adopted])].sort();
      tx.update(routingRule)
        .set({ adoptedAgentIds: union })
        .where(eq(routingRule.id, rule.id))
        .run();
    });
  }
  return copied;
}

import { createHash } from 'node:crypto';
import {
  isSessionStepKind,
  type RequiredCapabilities,
  type RouteOverride,
  type StepKind,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, agentMemory, chief, machine, routingRule, team, todo } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

type AgentRow = typeof agent.$inferSelect;
type RoutingRuleRow = typeof routingRule.$inferSelect;

let routingRulesOn = false;

export function setRoutingRulesEnabled(on: boolean): void {
  routingRulesOn = on;
}

export function routingRulesEnabled(): boolean {
  return routingRulesOn;
}

export function routeForStep(
  db: Db,
  todoRow: Pick<typeof todo.$inferSelect, 'teamId'>,
  kind: StepKind,
): RoutingRuleRow | null {
  if (!routingRulesOn) return null;
  const use = isSessionStepKind(kind) ? 'session' : kind === 'review' ? 'review' : null;
  if (use === null) return null;
  return (
    db
      .select()
      .from(routingRule)
      .where(and(eq(routingRule.teamId, todoRow.teamId), eq(routingRule.use, use)))
      .get() ?? null
  );
}

export function ruleAgent(route: RoutingRuleRow): AgentRow {
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
    tools: route.tools ?? [],
    secrets: route.secrets ?? [],
    defaultSkill: route.defaultSkill,
    skillsAllowlist: route.skillsAllowlist,
    mcpServers: route.mcpServers ?? [],
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

export function applyRoute(
  agentRow: AgentRow,
  route: RoutingRuleRow | null,
  override: RouteOverride | null = null,
): AgentRow {
  if (route === null) return agentRow;
  const session = route.use === 'session';
  const owned = session || route.use === 'review';
  return {
    ...agentRow,
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
    tools: (owned ? route.tools : null) ?? agentRow.tools,
    mcpServers: (owned ? route.mcpServers : null) ?? agentRow.mcpServers,
    skillsAllowlist: (owned ? route.skillsAllowlist : null) ?? agentRow.skillsAllowlist,
    defaultSkill: (owned ? route.defaultSkill : null) ?? agentRow.defaultSkill,
    secrets: (owned ? route.secrets : null) ?? agentRow.secrets,
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
      tools: source.tools,
      mcpServers: source.mcpServers,
      skillsAllowlist: source.skillsAllowlist,
      defaultSkill: source.defaultSkill,
      secrets: source.secrets,
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

export function seedReviewRules(db: Db): number {
  let inserted = 0;
  for (const { id: teamId } of db.select({ id: team.id }).from(team).all()) {
    if (ruleExists(db, teamId, 'review')) continue;
    const reviewer = db
      .select()
      .from(agent)
      .where(and(eq(agent.teamId, teamId), eq(agent.persona, 'code_reviewer')))
      .get();
    if (reviewer !== undefined) inserted += seedRule(db, teamId, 'review', reviewer);
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

export function adoptAgentMemories(db: Db): number {
  let copied = 0;
  for (const rule of db.select().from(routingRule).where(eq(routingRule.use, 'session')).all()) {
    const adopted = sessionAgentIds(db, rule);
    db.transaction((tx) => {
      const held = new Set(
        tx
          .select({ projectId: agentMemory.projectId, content: agentMemory.content })
          .from(agentMemory)
          .where(and(eq(agentMemory.agentId, rule.id), isNull(agentMemory.invalidAt)))
          .all()
          .map((row) => `${row.projectId ?? ''}\u0000${row.content}`),
      );
      for (const agentId of adopted) {
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
              supersededBy: null,
              lastInjectedAt: null,
            })
            .onConflictDoNothing()
            .run();
          copied += res.changes;
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

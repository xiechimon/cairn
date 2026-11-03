import {
  isSessionStepKind,
  type RequiredCapabilities,
  type RouteOverride,
  type StepKind,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, machine, routingRule, team, todo } from '../db/schema.js';
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
  if (!routingRulesOn || !isSessionStepKind(kind)) return null;
  return (
    db
      .select()
      .from(routingRule)
      .where(and(eq(routingRule.teamId, todoRow.teamId), eq(routingRule.use, 'session')))
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
  return {
    ...agentRow,
    provider: route.provider,
    modelId: route.modelId,
    thinkingLevel: route.thinkingLevel,
    fallbackModels: route.fallbackModels,
    machineId: (session ? override?.machineId : undefined) ?? route.machineId ?? agentRow.machineId,
    requiredCapabilities: session
      ? withOverride(route.requiredCapabilities, override?.requiredCapabilities)
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

export function seedRoutingRules(db: Db): number {
  let inserted = 0;
  for (const { id: teamId } of db.select({ id: team.id }).from(team).all()) {
    const existing = db
      .select({ id: routingRule.id })
      .from(routingRule)
      .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'session')))
      .get();
    if (existing !== undefined) continue;
    const source = sessionSeedAgent(db, teamId);
    if (source?.provider == null || source.modelId == null) continue;
    const now = nowMs();
    db.insert(routingRule)
      .values({
        id: newRecordId(),
        teamId,
        use: 'session',
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
      .run();
    inserted += 1;
  }
  return inserted;
}

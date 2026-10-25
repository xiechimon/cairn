import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, chief, todo } from '../db/schema.js';

export interface AgentDeps {
  db: Db;
}

export function deleteAgent(deps: AgentDeps, teamId: string, agentId: string): boolean {
  const { db } = deps;
  const row = db
    .select()
    .from(agent)
    .where(and(eq(agent.id, agentId), eq(agent.teamId, teamId)))
    .get();
  if (!row) return false;
  db.transaction((tx) => {
    for (const todoRow of tx.select().from(todo).where(eq(todo.teamId, teamId)).all()) {
      const assignment = todoRow.assignment;
      if (assignment === null) continue;
      const plan = assignment.plan?.agentId === agentId ? null : assignment.plan;
      const build = assignment.build?.agentId === agentId ? null : assignment.build;
      if (plan === assignment.plan && build === assignment.build) continue;
      tx.update(todo).set({ assignment: { plan, build } }).where(eq(todo.id, todoRow.id)).run();
    }
    for (const chiefRow of tx.select().from(chief).where(eq(chief.teamId, teamId)).all()) {
      if (chiefRow.agentId !== agentId) continue;
      tx.update(chief).set({ agentId: null }).where(eq(chief.id, chiefRow.id)).run();
    }
    tx.delete(agent).where(eq(agent.id, agentId)).run();
  });
  return true;
}

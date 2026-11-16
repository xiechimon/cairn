import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routingRule, team } from '../db/schema.js';
import { defaultCoordinatorRule } from '../services/routing-rules.js';
import type { CoordinatorLogger } from './index.js';

export function warnTeamsWithoutCoordinatorRule(db: Db, logger: CoordinatorLogger): string[] {
  const missing: string[] = [];
  for (const { id } of db.select({ id: team.id }).from(team).all()) {
    const rule = db
      .select({ modelId: routingRule.modelId })
      .from(routingRule)
      .where(and(eq(routingRule.teamId, id), eq(routingRule.use, 'coordinator')))
      .get();
    if (rule?.modelId || defaultCoordinatorRule(db, id) !== null) continue;
    missing.push(id);
    logger.error(
      { teamId: id },
      'in-server Coordinator is on but this team has no coordinator routing rule with a model and no provider it can run on; chat is refused until one is set (PATCH /api/teams/:id/routing-rules/coordinator)',
    );
  }
  return missing;
}

import type { Assignment } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export function requireIntakeAssignment(
  deps: { db: Db; intakeAgentAllowlist?: readonly string[] },
  teamId: string,
  assignment: Assignment,
): void {
  if (assignment.source !== 'intake-label') return;
  if (assignment.plan == null && assignment.build == null) {
    throw new HttpError(
      409,
      'intake-label-assignment-failed: Restore the requested intake agent preset before dispatching this task.',
    );
  }
  for (const slot of [assignment.plan, assignment.build]) {
    if (slot == null) continue;
    const row = deps.db
      .select()
      .from(agent)
      .where(and(eq(agent.id, slot.agentId), eq(agent.teamId, teamId)))
      .get();
    if (
      row === undefined ||
      row.status !== 'active' ||
      row.secrets.length > 0 ||
      row.mcpServers.length > 0 ||
      !(deps.intakeAgentAllowlist ?? []).includes(row.displayName)
    ) {
      throw new HttpError(
        409,
        'agent-label-privileged: The intake preset agent must be active, allowlisted, and have no secrets or MCP servers before dispatch.',
      );
    }
  }
}

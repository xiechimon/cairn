import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, routingRule } from '../db/schema.js';
import { type EligibilityInput, machineEligibility } from './dispatch-eligibility.js';
import { fallbackMachineId, teamDefaultMachineId } from './machine-routing.js';

export function apiKeyProbeRunnerGrant(db: Db, teamId: string, machineId: string): string | null {
  const runner = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.id, machineId)))
    .get();
  if (
    runner === undefined ||
    !runner.online ||
    runner.tokenHash === null ||
    runner.retiredAt !== null ||
    runner.capabilities?.antigravitySubscriptionModels !== true
  )
    return null;
  const rules = db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.provider, 'antigravity')))
    .orderBy(routingRule.id)
    .all();
  const eligible = (rule: EligibilityInput['agent'] & EligibilityInput['model']) =>
    machineEligibility({
      machine: runner,
      agent: rule,
      model: rule,
      catalog: [],
      localProject: false,
      claudeRateBlocked: false,
      claudeSubscriptionMissing: false,
      devinSubscriptionMissing: false,
    }) === null;
  const pinned = rules.filter((rule) => rule.machineId === machineId && eligible(rule));
  if (pinned.length > 0) return JSON.stringify(['pinned', pinned]);
  const unpinned = rules.filter((rule) => rule.machineId === null && eligible(rule));
  if (rules.length === 0) {
    if (
      !eligible({
        machineId: null,
        requiredCapabilities: null,
        provider: 'antigravity',
        modelId: null,
      })
    )
      return null;
  } else if (unpinned.length === 0) {
    return null;
  }
  const defaultMachineId = teamDefaultMachineId(db, teamId);
  const teamMachines = db
    .select({
      id: machine.id,
      online: machine.online,
      kind: machine.kind,
      lastSeenAt: machine.lastSeenAt,
      retiredAt: machine.retiredAt,
    })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all();
  return fallbackMachineId(teamMachines, defaultMachineId) === machineId
    ? JSON.stringify(['default', defaultMachineId, unpinned])
    : null;
}

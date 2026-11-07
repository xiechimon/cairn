import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { routingRule } from '../src/db/schema.js';
import {
  DEFAULT_SESSION_MODEL,
  DEFAULT_SESSION_PROVIDER,
  seedDefaultRouting,
} from '../src/services/routing-migration.js';
import { listRoutingSettings } from '../src/services/routing-rules.js';
import { bootServer, insertMachine, subscriptionClaudeReport } from './helpers.js';

function coordinatorRules(s: ReturnType<typeof bootServer>) {
  return listRoutingSettings(s.db, s.team.id).rules.filter((rule) => rule.use === 'coordinator');
}

describe('seedDefaultRouting coordinator rule', () => {
  test('a team with no usable model source gets no coordinator rule', () => {
    const s = bootServer();
    insertMachine(s, { claudeCodeReport: null });
    insertMachine(s, {
      claudeCodeReport: { ...subscriptionClaudeReport, auth: { state: 'not-logged-in' } },
    });
    insertMachine(s, { claudeCodeReport: { ...subscriptionClaudeReport, installed: false } });
    expect(seedDefaultRouting(s.db)).toMatchObject({ coordinatorRules: 0 });
    expect(coordinatorRules(s)).toEqual([]);
  });

  test('a logged-in Claude Code machine seeds the coordinator rule on the default model', () => {
    const s = bootServer();
    insertMachine(s, { claudeCodeReport: subscriptionClaudeReport });
    expect(seedDefaultRouting(s.db)).toMatchObject({ coordinatorRules: 1 });
    expect(coordinatorRules(s)).toMatchObject([
      {
        use: 'coordinator',
        provider: DEFAULT_SESSION_PROVIDER,
        modelId: DEFAULT_SESSION_MODEL,
        machineId: null,
      },
    ]);
  });

  test('the first reported model is used when the default is not offered', () => {
    const s = bootServer();
    insertMachine(s, {
      claudeCodeReport: {
        ...subscriptionClaudeReport,
        models: [{ id: 'custom-model', name: 'custom-model' }],
      },
    });
    seedDefaultRouting(s.db);
    expect(coordinatorRules(s)[0]?.modelId).toBe('custom-model');
  });

  test('seeding is idempotent and never overrides an existing coordinator rule', () => {
    const s = bootServer();
    insertMachine(s, { claudeCodeReport: subscriptionClaudeReport });
    s.db
      .insert(routingRule)
      .values({
        id: 'existing-coordinator',
        teamId: s.team.id,
        use: 'coordinator',
        provider: 'pi',
        modelId: 'my-model',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(seedDefaultRouting(s.db)).toMatchObject({ coordinatorRules: 0 });
    expect(coordinatorRules(s)).toMatchObject([
      { id: 'existing-coordinator', modelId: 'my-model' },
    ]);
    s.db.delete(routingRule).where(eq(routingRule.use, 'coordinator')).run();
    seedDefaultRouting(s.db);
    expect(seedDefaultRouting(s.db)).toMatchObject({ coordinatorRules: 0 });
    expect(coordinatorRules(s)).toHaveLength(1);
  });
});

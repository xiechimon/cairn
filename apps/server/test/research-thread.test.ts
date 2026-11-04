import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { agent, build, chief, routingRule, step, todo } from '../src/db/schema.js';
import { openResearchThread } from '../src/services/research-thread.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

async function world() {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'research');
  return { s, projectId, teamId: s.team.id };
}

function addAgent(
  s: TestServer,
  id: string,
  fields: Partial<typeof agent.$inferInsert> = {},
): void {
  s.db
    .insert(agent)
    .values({
      id,
      teamId: s.team.id,
      displayName: id,
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      ...fields,
    })
    .run();
}

const base = { title: 'Pick a queue library', question: 'Which queue library fits?' };

describe('openResearchThread', () => {
  test('refuses, creating nothing, when the session route sends builds to a runtime other than Claude Code', async () => {
    const w = await world();
    addAgent(w.s, 'agent-sonnet');
    w.s.db
      .insert(routingRule)
      .values({
        id: 'rule-session',
        teamId: w.teamId,
        use: 'session',
        provider: 'openai-codex',
        modelId: 'gpt-6.1-sol',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    setRoutingRulesEnabled(true);
    try {
      const before = w.s.db.select().from(todo).all().length;
      expect(() =>
        openResearchThread(w.s.svc, { teamId: w.teamId, projectId: w.projectId, tier: 1, ...base }),
      ).toThrow(/Claude Code/);
      expect(w.s.db.select().from(todo).all()).toHaveLength(before);
    } finally {
      setRoutingRulesEnabled(false);
    }
  });

  test('creates an info todo and starts only its build step on the chosen agent', async () => {
    const w = await world();
    addAgent(w.s, 'agent-sonnet');
    const opened = openResearchThread(w.s.svc, {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 1,
      ...base,
    });
    const row = w.s.db.select().from(todo).where(eq(todo.id, opened.todoId)).get();
    expect(row?.output).toBe('info');
    expect(row?.title).toBe(base.title);
    expect(row?.spec).toContain(base.question);
    expect(row?.spec).toContain('3 到 15 次工具调用');
    expect(row?.spec).toContain('1500');
    expect(row?.assignment).toMatchObject({ plan: null, build: { agentId: 'agent-sonnet' } });
    const builds = w.s.db.select().from(build).all();
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ withPlan: false, triggerSource: 'chief' });
    expect(row?.latestBuildId).toBe(builds[0]?.id);
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.kind),
    ).toEqual(['build']);
  });

  test('tier 2 prompt tells the lead to fan out sub-searches', async () => {
    const w = await world();
    addAgent(w.s, 'agent-opus', { modelId: 'claude-opus-5-5' });
    const opened = openResearchThread(w.s.svc, {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 2,
      ...base,
    });
    const row = w.s.db.select().from(todo).where(eq(todo.id, opened.todoId)).get();
    expect(row?.spec).toContain('3 到 5 个');
    expect(row?.spec).toContain('子代理');
  });

  test('defaults to opus for tier 2 and sonnet for tier 1', async () => {
    const w = await world();
    addAgent(w.s, 'agent-a-haiku', { modelId: 'claude-haiku-5-5' });
    addAgent(w.s, 'agent-sonnet', { modelId: 'claude-sonnet-5-5' });
    addAgent(w.s, 'agent-opus', { modelId: 'claude-opus-5-5' });
    const pick = (tier: 1 | 2) =>
      openResearchThread(w.s.svc, {
        teamId: w.teamId,
        projectId: w.projectId,
        tier,
        ...base,
      }).agentId;
    expect(pick(2)).toBe('agent-opus');
    expect(pick(1)).toBe('agent-sonnet');
  });

  test('without the tier model, a sonnet or opus agent beats a haiku agent', async () => {
    const w = await world();
    addAgent(w.s, 'agent-a-haiku', { modelId: 'claude-haiku-5-5' });
    addAgent(w.s, 'agent-sonnet', { modelId: 'claude-sonnet-5-5' });
    const opened = openResearchThread(w.s.svc, {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 2,
      ...base,
    });
    expect(opened.agentId).toBe('agent-sonnet');
  });

  test('falls back to any active Claude Code agent and skips pi, inactive and Coordinator agents', async () => {
    const w = await world();
    addAgent(w.s, 'agent-pi', { provider: 'stub-gw', modelId: 'claude-opus-5-5' });
    addAgent(w.s, 'agent-off', { status: 'archived', modelId: 'claude-opus-5-5' });
    addAgent(w.s, 'agent-coordinator', { modelId: 'claude-opus-5-5' });
    addAgent(w.s, 'agent-haiku', { modelId: 'claude-haiku-5-5' });
    w.s.db
      .insert(chief)
      .values({
        id: 'chief-1',
        userId: w.s.user.id,
        teamId: w.teamId,
        agentId: 'agent-coordinator',
        createdAt: 1,
      })
      .run();
    const opened = openResearchThread(w.s.svc, {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 2,
      ...base,
    });
    expect(opened.agentId).toBe('agent-haiku');
  });

  test('an explicit agent wins', async () => {
    const w = await world();
    addAgent(w.s, 'agent-opus', { modelId: 'claude-opus-5-5' });
    addAgent(w.s, 'agent-other', { modelId: 'claude-haiku-5-5' });
    const opened = openResearchThread(w.s.svc, {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 2,
      agentId: 'agent-other',
      ...base,
    });
    expect(opened.agentId).toBe('agent-other');
  });

  test('no Claude Code agent throws a clear error and creates nothing', async () => {
    const w = await world();
    addAgent(w.s, 'agent-pi', { provider: 'stub-gw' });
    expect(() =>
      openResearchThread(w.s.svc, {
        teamId: w.teamId,
        projectId: w.projectId,
        tier: 1,
        ...base,
      }),
    ).toThrow(/Claude Code agent/);
    expect(w.s.db.select().from(todo).all()).toHaveLength(0);
    expect(w.s.db.select().from(build).all()).toHaveLength(0);
  });

  test('the same source opens one thread however often it is asked', async () => {
    const w = await world();
    addAgent(w.s, 'agent-sonnet');
    const input = {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 1 as const,
      source: { kind: 'research-intake' as const, ref: 'research-intake:2026-10-27' },
      ...base,
    };
    const first = openResearchThread(w.s.svc, input);
    const second = openResearchThread(w.s.svc, input);
    expect(second).toEqual(first);
    expect(w.s.db.select().from(todo).all()).toHaveLength(1);
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
  });

  test('a source todo whose build never started gets its build on the next call', async () => {
    const w = await world();
    addAgent(w.s, 'agent-sonnet');
    const input = {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 1 as const,
      source: { kind: 'research-intake' as const, ref: 'research-intake:2026-10-27' },
      ...base,
    };
    const first = openResearchThread(w.s.svc, input);
    w.s.db.delete(step).run();
    w.s.db.delete(build).run();
    w.s.db
      .update(todo)
      .set({ phase: 'todo', latestBuildId: null })
      .where(eq(todo.id, first.todoId))
      .run();
    const again = openResearchThread(w.s.svc, input);
    expect(again.todoId).toBe(first.todoId);
    expect(w.s.db.select().from(todo).all()).toHaveLength(1);
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
  });
});

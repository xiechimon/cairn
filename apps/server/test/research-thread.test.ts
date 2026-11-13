import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { build, machine, step, team, todo } from '../src/db/schema.js';
import { claimStep } from '../src/services/machine-claim.js';
import { openResearchThread } from '../src/services/research-thread.js';
import { bootServer, insertMachine, postProject, seedSessionRoute } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

async function world() {
  const s = bootServer();
  insertMachine(s);
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'research');
  return { s, projectId, teamId: s.team.id };
}

const base = { title: 'Pick a queue library', question: 'Which queue library fits?' };

describe('openResearchThread', () => {
  test('refuses, creating nothing, when the session route sends builds to a runtime other than Claude Code', async () => {
    const w = await world();
    seedSessionRoute(w.s, { provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
    const before = w.s.db.select().from(todo).all().length;
    expect(() =>
      openResearchThread(w.s.svc, { teamId: w.teamId, projectId: w.projectId, tier: 1, ...base }),
    ).toThrow(/Claude Code/);
    expect(w.s.db.select().from(todo).all()).toHaveLength(before);
  });

  test('refuses, creating nothing, when the team has no session route', async () => {
    const w = await world();
    expect(() =>
      openResearchThread(w.s.svc, { teamId: w.teamId, projectId: w.projectId, tier: 1, ...base }),
    ).toThrow(/session routing rule/);
    expect(w.s.db.select().from(todo).all()).toHaveLength(0);
    expect(w.s.db.select().from(build).all()).toHaveLength(0);
  });

  test('creates an info todo and starts only its session step', async () => {
    const w = await world();
    seedSessionRoute(w.s);
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
    ).toEqual(['session']);
  });

  test('tier 2 prompt tells the lead to fan out sub-searches', async () => {
    const w = await world();
    seedSessionRoute(w.s);
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

  test('the claimed step runs on the session route', async () => {
    const w = await world();
    w.s.db.update(team).set({ claudeUsage: 'allow-paid' }).run();
    w.s.db
      .insert(machine)
      .values(
        readyMachine({
          id: 'research-host',
          teamId: w.teamId,
          name: 'Research host',
          online: true,
          enabledRuntimes: ['claude-code'],
          capabilities: { mcpServers: [], skills: [], executor: 'host' },
        }),
      )
      .run();
    const routeId = seedSessionRoute(w.s, { machineId: 'research-host' });
    const opened = openResearchThread(w.s.svc, {
      teamId: w.teamId,
      projectId: w.projectId,
      tier: 1,
      ...base,
    });
    const claimed = await claimStep(
      {
        ...w.s.svc,
        box: w.s.secretBox,
        reposDir: w.s.reposDir,
        attachmentsDir: w.s.attachmentsDir,
      },
      'research-host',
      w.teamId,
      0,
      'http://localhost',
    );
    expect(claimed?.step.buildId).toBe(opened.buildId);
    expect(claimed?.agent?.id).toBe(routeId);
  });

  test('the same source opens one thread however often it is asked', async () => {
    const w = await world();
    seedSessionRoute(w.s);
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
    seedSessionRoute(w.s);
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

import { describe, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { buildChiefSystemPrompt } from '../src/services/chief.js';
import { capMemories, injectMemoriesCapped, searchMemoryEntries } from '../src/services/memory.js';
import { projectTurnContextTraced } from '../src/services/project-instructions.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

function put(
  id: string,
  text: string,
  over: { projectId?: string | null; updatedAt?: number } = {},
) {
  H.s.db
    .insert(agentMemory)
    .values({
      id,
      agentId: AGENT_ID,
      teamId: H.teamId,
      title: `title ${id}`,
      content: text,
      projectId: over.projectId ?? null,
      sourceTodoId: null,
      sourceBuildId: null,
      createdAt: 1000,
      updatedAt: over.updatedAt ?? 1000,
    })
    .run();
}

const row = (id: string, content: string, updatedAt: number) => ({
  id,
  title: id,
  content,
  updatedAt,
});

describe('capMemories', () => {
  test('keeps the most recently updated entries that fit and reports the rest', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => row(id, 'x'.repeat(300), i));
    const { shown, omitted } = capMemories(rows, 250);
    expect(shown.map((r) => r.id)).toEqual(['c', 'd']);
    expect(omitted).toBe(2);
  });

  test('skips an entry that alone exceeds the cap and still takes smaller ones', () => {
    const rows = [row('small', 'ok', 1), row('huge', 'x'.repeat(100_000), 9)];
    const { shown, omitted } = capMemories(rows, 100);
    expect(shown.map((r) => r.id)).toEqual(['small']);
    expect(omitted).toBe(1);
  });

  test('when every entry alone exceeds the cap, the newest is cut to fit and the rest are counted', () => {
    const rows = ['a', 'b', 'c'].map((id, i) => row(id, 'x'.repeat(20_000), i));
    const { shown, omitted } = capMemories(rows, 500);
    expect(shown.map((r) => r.id)).toEqual(['c']);
    expect(shown[0]?.content.length).toBeLessThan(500);
    expect(omitted).toBe(2);
  });

  test('shows everything when it all fits', () => {
    expect(capMemories([row('a', 'x', 1), row('b', 'y', 2)], 1000)).toMatchObject({ omitted: 0 });
  });
});

describe('capped injection', () => {
  test('marks only the shown entries as injected', () => {
    for (let i = 0; i < 20; i++) put(`m${i}`, 'x'.repeat(300), { updatedAt: i });
    const { memories, omitted } = injectMemoriesCapped(
      H.s.db,
      { agentId: AGENT_ID, teamId: H.teamId, projectId: null },
      500,
    );
    expect(memories.length + omitted).toBe(20);
    expect(omitted).toBeGreaterThan(0);
    const stamped = H.s.db
      .select({ id: agentMemory.id, at: agentMemory.lastInjectedAt })
      .from(agentMemory)
      .all()
      .filter((r) => r.at !== null)
      .map((r) => r.id);
    expect(stamped.sort()).toEqual(memories.map((m) => m.id).sort());
  });

  test('the Coordinator system prompt names the overflow and the search tool, and carries no project memory', () => {
    for (let i = 0; i < 40; i++) put(`t${i}`, 'z'.repeat(400), { updatedAt: i });
    put('proj-1', 'PROJECT-ONLY-FACT', { projectId: H.projectId });
    const prompt = buildChiefSystemPrompt(H.s.svc, H.teamId, H.threadId);
    expect(prompt.memoriesOmitted).toBeGreaterThan(0);
    expect(prompt.text).toContain(`另有 ${prompt.memoriesOmitted} 条团队记忆`);
    expect(prompt.text).toContain('query');
    expect(prompt.text).not.toContain('PROJECT-ONLY-FACT');
    expect(prompt.memoryIds).not.toContain('proj-1');
  });
});

describe('project memory is loaded only for a routed project', () => {
  test('no routed project loads nothing', () => {
    put('proj-1', 'PROJECT-ONLY-FACT', { projectId: H.projectId });
    expect(
      projectTurnContextTraced(H.s.db, {
        teamId: H.teamId,
        agentId: AGENT_ID,
        projectId: null,
        threadId: H.threadId,
      }),
    ).toBeNull();
  });

  test('a project whose memories are all oversized still gets a cut entry and the overflow notice', () => {
    for (const id of ['p1', 'p2', 'p3']) {
      put(id, 'w'.repeat(30_000), { projectId: H.projectId, updatedAt: Number(id.slice(1)) });
    }
    const traced = projectTurnContextTraced(
      H.s.db,
      { teamId: H.teamId, agentId: AGENT_ID, projectId: H.projectId, threadId: H.threadId },
      800,
    );
    expect(traced?.memoryIds).toEqual(['p3']);
    expect(traced?.memoriesOmitted).toBe(2);
    expect(traced?.text).toContain('另有 2 条项目记忆');
    expect(traced?.text.length).toBeLessThan(3_000);
  });

  test('a routed project loads its own memories and never another project’s or team-wide ones', () => {
    put('proj-1', 'PROJECT-ONLY-FACT', { projectId: H.projectId });
    put('other-1', 'OTHER-PROJECT-FACT', { projectId: 'some-other-project' });
    put('team-1', 'TEAM-WIDE-FACT');
    const traced = projectTurnContextTraced(H.s.db, {
      teamId: H.teamId,
      agentId: AGENT_ID,
      projectId: H.projectId,
      threadId: H.threadId,
    });
    expect(traced?.memoryIds).toEqual(['proj-1']);
    expect(traced?.text).toContain('PROJECT-ONLY-FACT');
    expect(traced?.text).not.toContain('OTHER-PROJECT-FACT');
    expect(traced?.text).not.toContain('TEAM-WIDE-FACT');
  });
});

describe('overflow goes through search', () => {
  test('searchMemoryEntries needs every term, case and width folded', () => {
    const entries = [
      { title: 'Deploy', content: 'Use the Queue' },
      { title: 'Other', content: 'queue only' },
    ];
    expect(searchMemoryEntries(entries, 'deploy QUEUE')).toEqual([entries[0]]);
    expect(searchMemoryEntries(entries, '   ')).toHaveLength(2);
    expect(searchMemoryEntries(entries, 'absent')).toEqual([]);
  });

  test('the memories tool finds an entry the prompt could not show', async () => {
    for (let i = 0; i < 30; i++) put(`f${i}`, 'filler '.repeat(80), { updatedAt: 100 + i });
    put('old-1', `rollback uses the blue lane ${'pad '.repeat(250)}`, { updatedAt: 1 });
    const prompt = buildChiefSystemPrompt(H.s.svc, H.teamId, H.threadId);
    expect(prompt.memoryIds).not.toContain('old-1');
    const hits = (await relay('memories', { query: 'rollback blue' })) as { id: string }[];
    expect(hits.map((h) => h.id)).toEqual(['old-1']);
  });
});

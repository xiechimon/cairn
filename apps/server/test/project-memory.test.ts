import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { saveMemoryEntry } from '../src/services/memory.js';
import { AGENT_ID, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

function seedMemory(title: string, content: string, projectId: string | null): { id: string } {
  const saved = saveMemoryEntry(H.s.db, {
    agentId: AGENT_ID,
    teamId: H.teamId,
    title,
    content,
    projectId,
    sourceTodoId: null,
    sourceBuildId: null,
  });
  if (!('id' in saved)) throw new Error('memory not saved');
  return saved;
}

describe('Coordinator memory is scoped by project (D74 P2)', () => {
  test('the Coordinator system prompt carries team-wide memories only', async () => {
    const other = await postProject(H.s.app, 'other');
    seedMemory('team rule', 'commits are English', null);
    seedMemory('demo rule', 'deploys go to the Mac', H.projectId);
    seedMemory('other rule', 'site uses a serif font', other);
    const prompt = composeChiefSystemPrompt(toolDeps(), H.teamId);
    expect(prompt).toContain('team rule');
    expect(prompt).not.toContain('demo rule');
    expect(prompt).not.toContain('other rule');
  });

  test('a memory saved in a project-scoped turn is project-only by default', async () => {
    const saved = (await relay(
      'save_memory',
      { title: 'scoped', content: 'only here' },
      { turnScopeProjectId: H.projectId },
    )) as { projectId: string | null };
    expect(saved.projectId).toBe(H.projectId);
  });

  test('a memory saved in an unscoped turn stays team-wide', async () => {
    const saved = (await relay('save_memory', { title: 'team', content: 'everywhere' })) as {
      projectId: string | null;
    };
    expect(saved.projectId).toBeNull();
  });

  test('an explicit project on save_memory wins over the turn scope', async () => {
    const other = await postProject(H.s.app, 'other');
    const saved = (await relay(
      'save_memory',
      { title: 'other', content: 'for other', projectId: other },
      { turnScopeProjectId: H.projectId },
    )) as { projectId: string | null };
    expect(saved.projectId).toBe(other);
  });
});

describe('promoting a project memory to team-wide (D74 P2)', () => {
  test('promote clears the project so every turn and thread sees it', async () => {
    const row = seedMemory('promote me', 'reviews need two vendors', H.projectId);
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/agents/${AGENT_ID}/memories/${row.id}/promote`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: row.id, projectId: null });
    const stored = H.s.db.select().from(agentMemory).where(eq(agentMemory.id, row.id)).get();
    expect(stored?.projectId).toBeNull();
    expect(composeChiefSystemPrompt(toolDeps(), H.teamId)).toContain('promote me');
  });

  test('promoting a memory of another agent or a missing memory is 404', async () => {
    const row = seedMemory('mine', 'staging lives on port 8399', H.projectId);
    const wrongAgent = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/agents/someone-else/memories/${row.id}/promote`,
    );
    expect(wrongAgent.status).toBe(404);
    const missing = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/agents/${AGENT_ID}/memories/no-such/promote`,
    );
    expect(missing.status).toBe(404);
    expect(
      H.s.db.select().from(agentMemory).where(eq(agentMemory.id, row.id)).get()?.projectId,
    ).toBe(H.projectId);
  });
});

import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agentMemory, chiefMessage, project, step } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { steeredFromAnotherScope } from '../src/services/machine-relay.js';
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

  test('an explicitly project-scoped file stays in that project', async () => {
    const saved = (await relay(
      'save_memory',
      { scope: H.projectId, file: 'scoped', content: 'only here' },
      { turnScopeProjectId: H.projectId },
    )) as { scope: string };
    expect(saved.scope).toBe(H.projectId);
  });

  test('writing an archived project scope is refused', async () => {
    H.s.db.update(project).set({ archivedAt: nowMs() }).where(eq(project.id, H.projectId)).run();
    await expect(
      relay(
        'save_memory',
        { scope: H.projectId, file: 'late', content: 'after archive' },
        { turnScopeProjectId: H.projectId },
      ),
    ).rejects.toThrow(/archived/);
  });

  test('a memory saved in an unscoped turn stays team-wide', async () => {
    const saved = (await relay('save_memory', {
      scope: 'team',
      file: 'team',
      content: 'everywhere',
    })) as {
      scope: string;
    };
    expect(saved.scope).toBe('team');
  });

  test('an explicit scope wins over the turn scope', async () => {
    const other = await postProject(H.s.app, 'other');
    const saved = (await relay(
      'save_memory',
      { file: 'other', content: 'for other', scope: other },
      { turnScopeProjectId: H.projectId },
    )) as { scope: string };
    expect(saved.scope).toBe(other);
  });
});

describe('a turn that was steered into another project (D74 P2)', () => {
  test('save_memory requires an explicit scope even in a mixed turn', async () => {
    await expect(
      relay(
        'save_memory',
        { file: 'ambiguous', content: 'which project?' },
        { turnScopeProjectId: H.projectId, turnScopeMixed: true },
      ),
    ).rejects.toThrow(/scope/);
    const other = await postProject(H.s.app, 'other');
    const saved = (await relay(
      'save_memory',
      { file: 'explicit', content: 'for other', scope: other },
      { turnScopeProjectId: H.projectId, turnScopeMixed: true },
    )) as { scope: string };
    expect(saved.scope).toBe(other);
  });

  test('only a message steered into the turn from another project marks it mixed, not a queued one', async () => {
    const other = await postProject(H.s.app, 'other');
    const claimedAt = nowMs() - 1000;
    H.s.db
      .insert(step)
      .values({
        id: 'turn-a',
        buildId: H.threadId,
        kind: 'chief',
        status: 'claimed',
        prompt: 'plan it',
        scopeProjectId: H.projectId,
        claimedAt,
        createdAt: claimedAt - 10,
      })
      .run();
    const turn = H.s.db
      .select()
      .from(step)
      .all()
      .find((row) => row.id === 'turn-a')!;
    const message = (id: string, projectId: string | null, createdAt: number) =>
      H.s.db
        .insert(chiefMessage)
        .values({ id, threadId: H.threadId, role: 'user', content: id, projectId, createdAt })
        .run();
    message('own', H.projectId, claimedAt - 5);
    message('same-project', H.projectId, claimedAt + 5);
    expect(steeredFromAnotherScope(toolDeps() as never, turn)).toBe(false);
    message('queued-other', other, claimedAt + 8);
    H.s.db
      .insert(step)
      .values({
        id: 'queued-other',
        buildId: H.threadId,
        kind: 'chief',
        status: 'pending',
        prompt: 'queued-other',
        scopeProjectId: other,
        createdAt: claimedAt + 8,
      })
      .run();
    expect(steeredFromAnotherScope(toolDeps() as never, turn)).toBe(false);
    message('other-project', other, claimedAt + 10);
    expect(steeredFromAnotherScope(toolDeps() as never, turn)).toBe(true);
  });
});

describe('promoting a project memory to team-wide (D74 P2)', () => {
  test('promote clears the project so every turn and thread sees it', async () => {
    const row = seedMemory('promote me', 'reviews need two vendors', H.projectId);
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/memories/${row.id}/promote`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: row.id, projectId: null });
    const stored = H.s.db.select().from(agentMemory).where(eq(agentMemory.id, row.id)).get();
    expect(stored?.projectId).toBeNull();
    expect(composeChiefSystemPrompt(toolDeps(), H.teamId)).toContain('promote me');
    const again = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/memories/${row.id}/promote`);
    expect(again.status).toBe(200);
  });

  test('promoting a missing memory is 404', async () => {
    const row = seedMemory('mine', 'staging lives on port 8399', H.projectId);
    const missing = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/memories/no-such/promote`);
    expect(missing.status).toBe(404);
    expect(
      H.s.db.select().from(agentMemory).where(eq(agentMemory.id, row.id)).get()?.projectId,
    ).toBe(H.projectId);
  });
});

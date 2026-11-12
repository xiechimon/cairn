import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { step } from '../../src/db/schema.js';
import {
  foldMemoryIndexes,
  listStoredMemoryEntries,
  saveMemoryEntry,
} from '../../src/services/memory.js';
import { coordinatorProfile } from '../../src/services/routing-rules.js';
import { req } from '../helpers.js';
import { boot, stub, world } from './runner-world.js';

async function projectNamed(w: Awaited<ReturnType<typeof world>>, name: string): Promise<string> {
  const res = await req(w.s.app, 'POST', '/api/projects', { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function remember(
  w: Awaited<ReturnType<typeof world>>,
  content: string,
  projectId: string | null,
): string {
  const agentId = coordinatorProfile(w.s.db, w.teamId)?.id ?? '';
  const saved = saveMemoryEntry(w.s.db, {
    agentId,
    teamId: w.teamId,
    title: `t-${content.slice(0, 8)}`,
    content,
    projectId,
    sourceTodoId: null,
    sourceBuildId: null,
  });
  return saved.id;
}

async function runTurn(w: Awaited<ReturnType<typeof world>>) {
  const { faux, seen } = stub('ok');
  const lines: { obj: Record<string, unknown>; message: string }[] = [];
  const sink = (obj: object, message: string) =>
    lines.push({ obj: obj as Record<string, unknown>, message });
  const coordinator = boot(w, faux, { logger: { info: sink, warn: sink, error: sink } });
  coordinator.wake(w.threadId);
  await coordinator.idle();
  const trace = lines.find((l) => l.message === 'coordinator memory injected')?.obj;
  const indexes = listStoredMemoryEntries(w.s.db, { teamId: w.teamId, agentId: '' });
  return { seen, trace, indexes };
}

describe('Coordinator memory loading per turn', () => {
  it('an unrouted turn loads team memory once and no project memory, and logs ids only', async () => {
    const w = await world('hello');
    const projectA = await projectNamed(w, 'Alpha');
    remember(w, 'TEAM-FACT-ALPHA', null);
    const projId = remember(w, 'PROJECT-FACT-ALPHA', projectA);
    foldMemoryIndexes(w.s.db);
    const { seen, trace, indexes } = await runTurn(w);
    const messages = JSON.stringify(seen[0]?.messages);
    expect(messages.split('TEAM-FACT-ALPHA')).toHaveLength(2);
    expect(messages).not.toContain('PROJECT-FACT-ALPHA');
    expect(trace).toMatchObject({
      teamMemoryIds: [indexes.find((m) => m.projectId === null)!.id],
      projectMemoryIds: [],
      projectId: null,
    });
    expect(JSON.stringify(trace)).not.toContain('FACT-ALPHA');
    expect(projId).toBeTruthy();
  });

  it('a turn routed to a project loads that project’s memory only', async () => {
    const w = await world('hello');
    const projectA = await projectNamed(w, 'Alpha');
    const projectB = await projectNamed(w, 'Beta');
    remember(w, 'PROJECT-FACT-ALPHA', projectA);
    remember(w, 'PROJECT-FACT-BETA', projectB);
    w.s.db.update(step).set({ scopeProjectId: projectA }).where(eq(step.id, w.stepId)).run();
    foldMemoryIndexes(w.s.db);
    const { seen, trace, indexes } = await runTurn(w);
    const all = JSON.stringify(seen[0]?.messages);
    expect(all).toContain('PROJECT-FACT-ALPHA');
    expect(all).not.toContain('PROJECT-FACT-BETA');
    expect(trace).toMatchObject({
      projectMemoryIds: [indexes.find((m) => m.projectId === projectA)!.id],
      projectId: projectA,
    });
    expect(JSON.stringify(trace)).not.toContain('FACT-');
  });
});

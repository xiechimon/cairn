import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { ensureMemoryIndex } from '../src/services/memory.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

function boot() {
  const s = bootServer();
  servers.push(s);
  return s;
}

function seedDocument(s: TestServer, title: string, content: string) {
  s.db
    .insert(agentMemory)
    .values({
      id: `doc-${title}`,
      agentId: s.team.id,
      teamId: s.team.id,
      title,
      content,
      layer: 'searchable',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return `doc-${title}`;
}

describe('PATCH /api/teams/{id}/memories/{mid}', () => {
  test('edits a searchable document: successor row, old row superseded, list shows the new text', async () => {
    const s = boot();
    const id = seedDocument(s, 'deploy-notes.md', 'ship friday');
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/memories/${id}`, {
      content: 'ship monday',
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { id: string; content: string };
    expect(updated.id).not.toBe(id);
    expect(updated.content).toBe('ship monday');
    const prior = s.db.select().from(agentMemory).where(eq(agentMemory.id, id)).get();
    expect(prior?.supersededBy).toBe(updated.id);
    const successor = s.db
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.id, updated.id))
      .get();
    expect(successor?.history.at(-1)?.content).toBe('ship friday');
    const list = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/memories`)
    ).json()) as { id: string; content: string }[];
    expect(list.some((m) => m.id === updated.id && m.content === 'ship monday')).toBe(true);
  });

  test('renames a searchable document file', async () => {
    const s = boot();
    const id = seedDocument(s, 'old-name.md', 'body');
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/memories/${id}`, {
      title: 'new-name.md',
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { title: string };
    expect(updated.title).toBe('new-name.md');
  });

  test('edits the MEMORY.md index through the document path', async () => {
    const s = boot();
    const index = ensureMemoryIndex(s.db, { agentId: s.team.id, teamId: s.team.id, projectId: null });
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/memories/${index.id}`, {
      content: 'always run pnpm test',
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { id: string; content: string; layer: string };
    expect(updated.layer).toBe('core');
    expect(updated.content).toBe('always run pnpm test');
  });

  test('edits a fact that lives inside a legacy encoded index', async () => {
    const s = boot();
    s.db
      .insert(agentMemory)
      .values({
        id: 'memory-index:idx-1',
        agentId: s.team.id,
        teamId: s.team.id,
        title: 'MEMORY.md',
        content:
          '- {"id":"fact-1","title":"release uses pnpm","content":"release uses pnpm","fileId":null,"createdAt":1,"updatedAt":1,"lastInjectedAt":null,"history":[],"source":null,"sourceTodoId":null,"sourceBuildId":null}',
        layer: 'core',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/memories/fact-1`, {
      content: 'release uses pnpm build',
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { id: string; content: string };
    expect(updated.content).toBe('release uses pnpm build');
  });

  test('unknown memory and empty body reject', async () => {
    const s = boot();
    expect(
      (await req(s.app, 'PATCH', `/api/teams/${s.team.id}/memories/nope`, { content: 'x' })).status,
    ).toBe(404);
    const id = seedDocument(s, 'a.md', 'x');
    expect(
      (await req(s.app, 'PATCH', `/api/teams/${s.team.id}/memories/${id}`, {})).status,
    ).toBe(400);
    expect(
      (
        await req(s.app, 'PATCH', `/api/teams/${s.team.id}/memories/${id}`, {
          surprise: 1,
        })
      ).status,
    ).toBe(400);
  });
});

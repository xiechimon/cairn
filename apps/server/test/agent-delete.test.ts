import { todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  chief as chiefTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { bootServer, postProject, req } from './helpers.js';

const AGENT_A = 'agent-del-a';
const AGENT_B = 'agent-del-b';

async function expectErrorShape(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['error']);
}

function seedAgent(s: ReturnType<typeof bootServer>, id: string, displayName: string): void {
  s.db.insert(agentTable).values({ id, teamId: s.team.id, displayName, modelId: 'm' }).run();
}

async function todoAssignedTo(
  s: ReturnType<typeof bootServer>,
  projectId: string,
  agentId: string,
): Promise<string> {
  const todo = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'x', spec: '' })
    ).json(),
  );
  const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todo.id],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  });
  expect(started.status).toBe(201);
  return todo.id;
}

describe('DELETE /api/teams/{id}/agents/{aid} (XMON-19)', () => {
  test('unknown agent -> 404 {error}; deleting again after a 204 -> 404', async () => {
    const s = bootServer();
    await expectErrorShape(await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/nope`), 404);
    seedAgent(s, AGENT_A, 'a');
    const url = `/api/teams/${s.team.id}/agents/${AGENT_A}`;
    expect((await req(s.app, 'DELETE', url)).status).toBe(204);
    await expectErrorShape(await req(s.app, 'DELETE', url), 404);
    s.dispose();
  });

  test('post-delete read surfaces return 404: single GET and the memories read surface break on the same path', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );
    await expectErrorShape(
      await req(s.app, 'GET', `/api/teams/${s.team.id}/agents/${AGENT_A}`),
      404,
    );
    expect(s.db.select().from(agentTable).all()).toHaveLength(0);
    s.dispose();
  });

  test('cross-team isolation: another team path deleting this team Agent -> 404, row kept', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    await expectErrorShape(
      await req(s.app, 'DELETE', '/api/teams/other-team/agents/agent-del-a'),
      404,
    );
    expect(s.db.select().from(agentTable).all()).toHaveLength(1);
    s.dispose();
  });

  test('related surfaces: memories rows survive (docs "memory is kept"), scope columns untouched', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    const projectId = await postProject(s.app);
    s.db
      .insert(agentMemory)
      .values({
        id: 'mem-keep-1',
        agentId: AGENT_A,
        teamId: s.team.id,
        title: 'm',
        content: 'c',
        projectId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );

    const mem = s.db.select().from(agentMemory).all();
    expect(mem).toHaveLength(1);
    expect(mem[0]?.agentId).toBe(AGENT_A);
    expect(mem[0]?.projectId).toBe(projectId);
    s.dispose();
  });

  test('related surfaces: the todo.assignment slot pointing at this Agent is removed, other people and neighbor Agent slots untouched', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    seedAgent(s, AGENT_B, 'b');
    const projectId = await postProject(s.app);
    const todoA = await todoAssignedTo(s, projectId, AGENT_A);
    const todoB = await todoAssignedTo(s, projectId, AGENT_B);

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );

    const rows = s.db.select().from(todoTable).all();
    const rowA = rows.find((r) => r.id === todoA);
    const rowB = rows.find((r) => r.id === todoB);
    expect(rowA?.assignment).toEqual({ plan: null, build: null });
    expect(rowB?.assignment).toEqual({ plan: { agentId: AGENT_B }, build: { agentId: AGENT_B } });
    expect(rowA?.phase).toBe('queued');
    expect((await req(s.app, 'GET', `/api/todos/${todoA}`)).status).toBe(200);
    s.dispose();
  });

  test('related surfaces: chief bound to the deleted Agent -> null; bindings to other Agents untouched', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    seedAgent(s, AGENT_B, 'b');
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        agentId: AGENT_A,
        createdAt: Date.now(),
      })
      .run();

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );
    expect(s.db.select().from(chiefTable).all()[0]?.agentId).toBeNull();

    s.db.update(chiefTable).set({ agentId: AGENT_B }).where(eq(chiefTable.id, chiefId)).run();
    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      404,
    );
    expect(s.db.select().from(chiefTable).all()[0]?.agentId).toBe(AGENT_B);
    s.dispose();
  });

  test('isolation: deleting A does not hurt B (neighbor Agent row and grants surface unchanged)', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    seedAgent(s, AGENT_B, 'b');
    s.db
      .update(agentTable)
      .set({ tools: ['推送分支'], secrets: ['sec-1'], mcpServers: ['mcp-1'] })
      .where(eq(agentTable.id, AGENT_B))
      .run();

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );

    const rows = s.db.select().from(agentTable).all();
    expect(rows.map((r) => r.id)).toEqual([AGENT_B]);
    expect(rows[0]?.tools).toEqual(['推送分支']);
    expect(rows[0]?.secrets).toEqual(['sec-1']);
    expect(rows[0]?.mcpServers).toEqual(['mcp-1']);
    s.dispose();
  });
});

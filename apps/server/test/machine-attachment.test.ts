import { machineAttachmentResponseSchema, machineEnrollResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  attachment as attachmentTable,
  message as messageTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { createTodo, updateTodo } from '../src/services/todos.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

interface World {
  s: TestServer;
  token: string;
  stepId: string;
  todoId: string;
  buildId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 250 });
  const apiKey = await issueApiKey(s);
  const enrollAuth = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ teamId: s.team.id, name: 'att-machine' }),
  });
  expect(enrollAuth.status).toBe(200);
  const machineJson = machineEnrollResponseSchema.parse(await enrollAuth.json());
  const agentId = 'agent-stub-att';
  s.db
    .insert(agentTable)
    .values({
      id: agentId,
      teamId: s.team.id,
      displayName: agentId,
      description: null,
      status: 'active',
      avatarUrl: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
  bindAllAgents(s);
  const projectId = await postProject(s.app);
  const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Attachment probe',
    spec: 'Probe',
  });
  const todo = (await todoRes.json()) as { id: string };
  const buildRes = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todo.id],
    assignment: { plan: null, build: { agentId } },
    withPlan: false,
  });
  expect(buildRes.status).toBe(201);
  const claimRes = await s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${machineJson.token}` },
    body: JSON.stringify({}),
  });
  expect(claimRes.status).toBe(200);
  const claim = (await claimRes.json()) as { step: null | { step: { id: string } } };
  expect(claim.step).not.toBeNull();
  const stepId = claim.step!.step.id;
  const buildId = s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.buildId;
  return { s, token: machineJson.token, stepId, todoId: todo.id, buildId };
}

async function uploadOne(
  s: TestServer,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
): Promise<{ id: string }> {
  const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
    kind: 'attachment',
    fileName,
    mimeType,
    size: bytes.byteLength,
    scope: 'spec',
  });
  expect(grantRes.status).toBe(200);
  const g = (await grantRes.json()) as { grant: string; attachmentId: string };
  const form = new FormData();
  form.set('grant', g.grant);
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
  const upRes = await s.app.request('/api/uploads/upload', { method: 'POST', body: form });
  expect(upRes.status).toBe(201);
  return { id: g.attachmentId };
}

async function citeInSpec(w: World, attachmentId: string, ext: string): Promise<void> {
  const patch = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, {
    spec: `![file](attachment:${w.s.team.id}/${attachmentId}.${ext})`,
  });
  expect(patch.status).toBe(200);
}

async function pendingOne(s: TestServer): Promise<{ id: string }> {
  const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
    kind: 'attachment',
    fileName: 'half.png',
    mimeType: 'image/png',
    size: 100,
    scope: 'spec',
  });
  const g = (await grantRes.json()) as { attachmentId: string };
  return { id: g.attachmentId };
}

describe('GET /api/machine/attachment/{stepId}/{attachmentId} (#730)', () => {
  test('#1481 only human task text authorizes both attachment interfaces', async () => {
    const w = await setupWorld();
    try {
      const { id } = await uploadOne(w.s, 'private.png', 'image/png', PNG);
      const content = `![private](attachment:${w.s.team.id}/${id}.png)`;
      const projectId = w.s.db
        .select()
        .from(todoTable)
        .where(eq(todoTable.id, w.todoId))
        .get()!.projectId;
      const download = () =>
        w.s.app.request(`/api/machine/attachment/${w.stepId}/${id}?teamId=${w.s.team.id}`, {
          headers: { authorization: `Bearer ${w.token}` },
        });
      const workerOn = (todoId: string) =>
        executeWorkerMemoryTool(
          w.s.db,
          {
            teamId: w.s.team.id,
            agentId: 'agent-stub-att',
            todoId,
            projectId: null,
            buildId: w.buildId,
            attachmentsDir: w.s.attachmentsDir,
          },
          'attachment',
          { attachmentId: id },
        );
      const worker = () => workerOn(w.todoId);
      expect((await download()).status).toBe(404);
      await expect(worker()).rejects.toMatchObject({ status: 404 });
      const wrongTeam = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, {
        spec: `![private](attachment:team-other/${id}.png)`,
      });
      expect(wrongTeam.status).toBe(200);
      expect((await download()).status).toBe(404);
      await expect(worker()).rejects.toMatchObject({ status: 404 });
      const agentMade = createTodo(
        { db: w.s.db, hub: w.s.hub, user: w.s.user },
        {
          teamId: w.s.team.id,
          projectId,
          title: 'Agent spec',
          spec: content,
          createdBy: 'chief-agent',
          ownerId: w.s.user.id,
        },
      );
      await expect(workerOn(agentMade.id)).rejects.toMatchObject({ status: 404 });
      const created = await req(w.s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Human created',
        spec: content,
      });
      expect(created.status).toBe(201);
      const createdId = ((await created.json()) as { id: string }).id;
      expect(JSON.parse(await workerOn(createdId)).id).toBe(id);
      const patch = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { spec: content });
      expect(patch.status).toBe(200);
      expect((await download()).status).toBe(200);
      expect(JSON.parse(await worker()).id).toBe(id);
      updateTodo({ db: w.s.db, hub: w.s.hub, user: w.s.user }, w.todoId, { spec: content });
      expect((await download()).status).toBe(404);
      await expect(worker()).rejects.toMatchObject({ status: 404 });
      w.s.db
        .insert(messageTable)
        .values({
          id: 'agent-wrote-the-token',
          conversationId: w.buildId,
          role: 'user',
          content,
          createdAt: 1,
        })
        .run();
      expect((await download()).status).toBe(404);
      await expect(worker()).rejects.toMatchObject({ status: 404 });
      const steer = await req(w.s.app, 'POST', `/api/conversations/${w.buildId}/messages`, {
        content,
      });
      expect(steer.status).toBe(201);
      expect((await download()).status).toBe(200);
      expect(JSON.parse(await worker()).id).toBe(id);
      const reset = await req(w.s.app, 'POST', `/api/todos/${w.todoId}/reset`, {});
      expect(reset.status).toBe(200);
      expect((await download()).status).toBe(404);
      await expect(worker()).rejects.toMatchObject({ status: 404 });
    } finally {
      w.s.dispose();
    }
  });

  test('#1481 token team must exactly match the machine team, missing also refused', async () => {
    const w = await setupWorld();
    try {
      const { id } = await uploadOne(w.s, 'shot.png', 'image/png', PNG);
      for (const query of [
        '',
        '?teamId=team-other',
        `?teamId=${w.s.team.id.toUpperCase()}`,
        `?teamId=%20${w.s.team.id}`,
        `?teamId=${encodeURIComponent(`%${w.s.team.id}`)}`,
      ]) {
        const res = await w.s.app.request(`/api/machine/attachment/${w.stepId}/${id}${query}`, {
          headers: { authorization: `Bearer ${w.token}` },
        });
        expect(res.status, query).toBe(404);
      }
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 1: no token -> 401', async () => {
    const w = await setupWorld();
    try {
      const res = await w.s.app.request(`/api/machine/attachment/${w.stepId}/att-x`, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 5: ready attachment -> 200 + base64 round-trip + schema match', async () => {
    const w = await setupWorld();
    try {
      const { id } = await uploadOne(w.s, 'shot.png', 'image/png', PNG);
      await citeInSpec(w, id, 'png');
      const res = await w.s.app.request(
        `/api/machine/attachment/${w.stepId}/${id}?teamId=${w.s.team.id}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${w.token}` },
        },
      );
      expect(res.status).toBe(200);
      const parsed = machineAttachmentResponseSchema.parse(await res.json());
      expect(parsed.fileName).toBe('shot.png');
      expect(parsed.mimeType).toBe('image/png');
      expect(parsed.sizeBytes).toBe(PNG.byteLength);
      expect(Buffer.from(parsed.contentBase64, 'base64').equals(PNG)).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 4: pending attachment -> 409, reason carries the state word', async () => {
    const w = await setupWorld();
    try {
      const { id } = await pendingOne(w.s);
      await citeInSpec(w, id, 'png');
      const res = await w.s.app.request(
        `/api/machine/attachment/${w.stepId}/${id}?teamId=${w.s.team.id}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${w.token}` },
        },
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('pending');
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 3: step not on this machine -> 404', async () => {
    const w = await setupWorld();
    try {
      const { id } = await uploadOne(w.s, 'shot.png', 'image/png', PNG);
      const apiKey2 = await issueApiKey(w.s);
      const enroll2 = await w.s.app.request('/api/machine/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey2}` },
        body: JSON.stringify({ teamId: w.s.team.id, name: 'att-machine-2' }),
      });

      const m2 = machineEnrollResponseSchema.parse(await enroll2.json());
      const res = await w.s.app.request(
        `/api/machine/attachment/${w.stepId}/${id}?teamId=${w.s.team.id}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${m2.token}` },
        },
      );
      expect(res.status).toBe(404);
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 2: cross-team attachment -> 404 (existence not leaked)', async () => {
    const w = await setupWorld();
    try {
      const foreignId = 'att-foreign-1';
      w.s.db.insert(teamTable).values({ id: 'team-other', name: 'other', createdAt: 1 }).run();
      w.s.db
        .insert(attachmentTable)
        .values({
          id: foreignId,
          teamId: 'team-other',
          createdBy: 'user-x',
          fileName: 'secret.png',
          mimeType: 'image/png',
          sizeBytes: PNG.byteLength,
          storageKey: 'team-other/att-foreign-1.png',
          grantId: 'grant-foreign-1',
          scope: 'spec',
          status: 'ready',
          createdAt: 1,
        })
        .run();
      const res = await w.s.app.request(
        `/api/machine/attachment/${w.stepId}/${foreignId}?teamId=${w.s.team.id}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${w.token}` },
        },
      );
      expect(res.status).toBe(404);
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 6: browser surface GET /api/attachments/:id shape unchanged (raw bytes; machine surface independent and coexisting)', async () => {
    const w = await setupWorld();
    try {
      const { id } = await uploadOne(w.s, 'shot.png', 'image/png', PNG);
      await citeInSpec(w, id, 'png');
      const mres = await w.s.app.request(
        `/api/machine/attachment/${w.stepId}/${id}?teamId=${w.s.team.id}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${w.token}` },
        },
      );
      expect(mres.status).toBe(200);
      const bres = await w.s.app.request(`/api/attachments/${id}`, { method: 'GET' });
      expect(bres.status).toBe(200);
      expect(bres.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await bres.arrayBuffer()).equals(PNG)).toBe(true);
    } finally {
      w.s.dispose();
    }
  });
});

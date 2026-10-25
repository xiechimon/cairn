import { existsSync, utimesSync } from 'node:fs';
import {
  machineEnrollResponseSchema,
  machineOkResponseSchema,
  machineSessionResponseSchema,
  machineUploadUrlsResponseSchema,
  SESSION_FILE_NAME,
  SESSION_JSONL_MAX_BYTES,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, step as stepTable } from '../src/db/schema.js';
import { ATTACHMENT_ORPHAN_GRACE_MS, sweepStepSessions } from '../src/services/attachment-gc.js';
import { readStepSession, stepSessionPath } from '../src/services/machine-uploads.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, req } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: ReturnType<typeof bootServer>;
  token: string;
  stepId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 250 });
  disposables.push(() => s.dispose());
  const apiKey = await issueApiKey(s);
  const enrollAuth = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ teamId: s.team.id, name: 'session-machine' }),
  });
  expect(enrollAuth.status).toBe(200);
  const machineJson = machineEnrollResponseSchema.parse(await enrollAuth.json());
  const agentId = 'agent-stub-session';
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
    title: '会话附件',
    spec: '探针',
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
  return { s, token: machineJson.token, stepId: claim.step!.step.id };
}

async function putSession(w: World, content: string): Promise<Response> {
  const urlsRes = await w.s.app.request(`/api/machine/upload-urls/${w.stepId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${w.token}`,
    },
    body: JSON.stringify({ files: [{ name: SESSION_FILE_NAME, size: content.length }] }),
  });
  expect(urlsRes.status).toBe(200);
  const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
  const upload = urls.uploads[0]!;
  expect(upload.name).toBe(SESSION_FILE_NAME);
  return w.s.app.request(upload.url.replace(/^https?:\/\/[^/]+/, ''), {
    method: 'PUT',
    headers: {
      'content-type': 'application/x-ndjson',
      authorization: `Bearer ${w.token}`,
    },
    body: content,
  });
}

describe('session JSONL upload and per-step retrieval (#1512)', () => {
  test('failure mode 1: after PUT both the service function and GET retrieve the original text by stepId', async () => {
    const w = await setupWorld();
    const body = '{"type":"assistant","stopReason":"length","rawStopReason":"max_tokens"}\n';
    const put = await putSession(w, body);
    expect(machineOkResponseSchema.parse(await put.json())).toEqual({ ok: true });
    expect(readStepSession(w.s.attachmentsDir, w.stepId)).toBe(body);
    const get = await w.s.app.request(`/api/machine/session/${w.stepId}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${w.token}` },
    });
    expect(get.status).toBe(200);
    const parsed = machineSessionResponseSchema.parse(await get.json());
    expect(parsed.stepId).toBe(w.stepId);
    expect(parsed.content).toBe(body);
  });

  test('failure mode 2: over the cap -> nothing written, retrieval 404', async () => {
    const w = await setupWorld();
    const put = await putSession(w, 'x'.repeat(SESSION_JSONL_MAX_BYTES + 1));
    expect(put.status).toBe(413);
    expect(readStepSession(w.s.attachmentsDir, w.stepId)).toBeNull();
    const get = await w.s.app.request(`/api/machine/session/${w.stepId}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${w.token}` },
    });
    expect(get.status).toBe(404);
  });

  test('failure mode 3: never uploaded -> retrieval 404', async () => {
    const w = await setupWorld();
    const get = await w.s.app.request(`/api/machine/session/${w.stepId}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${w.token}` },
    });
    expect(get.status).toBe(404);
    expect(readStepSession(w.s.attachmentsDir, w.stepId)).toBeNull();
  });

  test('failure mode 4: kept while the step lives; collected only after the step is deleted and past grace', async () => {
    const w = await setupWorld();
    const body = '{"kept":true}\n';
    expect((await putSession(w, body)).status).toBe(200);
    const path = stepSessionPath(w.s.attachmentsDir, w.stepId);
    const now = Date.now();
    const log = { info() {}, debug() {} };
    sweepStepSessions({ db: w.s.db, attachmentsDir: w.s.attachmentsDir, logger: log }, now);
    expect(existsSync(path)).toBe(true);
    w.s.db.delete(stepTable).where(eq(stepTable.id, w.stepId)).run();
    sweepStepSessions({ db: w.s.db, attachmentsDir: w.s.attachmentsDir, logger: log }, now);
    expect(existsSync(path)).toBe(true);
    const old = (now - ATTACHMENT_ORPHAN_GRACE_MS - 1000) / 1000;
    utimesSync(path, old, old);
    sweepStepSessions({ db: w.s.db, attachmentsDir: w.s.attachmentsDir, logger: log }, now);
    expect(existsSync(path)).toBe(false);
  });
});

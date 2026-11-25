import { type ActionEntry, OWNER_CHANNEL_HEADER } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { AppContext } from '../src/context.js';
import { chief, chiefThread, project as projectTable } from '../src/db/schema.js';
import { proposalById } from '../src/services/action-proposals.js';
import { executeAction } from '../src/services/action-registry.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { bootServer, redeemTestPairing } from './helpers.js';

const TOKEN = 'owner-channel-test-token';
const KEY = 'owner-channel-test-key';

const noted: ActionEntry = {
  id: 'project.delete',
  toolName: 'delete_project',
  inputSchema: z.object({ projectId: z.string().min(1), note: z.string().optional() }).strict(),
  outputSchema: z.object({ projectId: z.string(), deleted: z.literal(true) }).strict(),
  scope: 'project',
  class: 'confirm-once',
  standingGrant: false,
  inverse: null,
  surfaces: ['web', 'coordinator'],
  targetOf: (input) => (input as { projectId: string }).projectId,
};

function world(
  ownerChannel: AppContext['ownerChannel'],
  opts: { accessVerifier?: AppContext['accessVerifier'] } = {},
) {
  const s = bootServer({ authToken: TOKEN, ownerChannel, ...opts });
  s.db.insert(projectTable).values({ id: 'project-a', teamId: s.team.id, name: 'Alpha' }).run();
  s.db
    .insert(chief)
    .values({ id: 'chief-a', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: 'thread-a',
      chiefId: 'chief-a',
      userId: s.user.id,
      teamId: s.team.id,
      title: 'thread-a',
      createdAt: 1,
      updatedAt: 1,
      sessionId: 'thread-a',
      sessionOpenedAt: 1,
    })
    .run();
  return s;
}

function pendingProposal(s: ReturnType<typeof world>): string {
  const proposed = executeAction(
    { db: s.db, reposDir: s.reposDir },
    {
      id: 'project.delete',
      input: { projectId: 'project-a' },
      actor: 'coordinator',
      surface: 'coordinator',
      teamId: s.team.id,
      threadId: 'thread-a',
      scopeProjectId: 'project-a',
      registry: [noted],
    },
  );
  if (proposed.status !== 'pending') throw new Error('expected a pending proposal');
  return proposed.proposalId;
}

function post(
  s: ReturnType<typeof world>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> | Response {
  return s.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function answer(
  s: ReturnType<typeof world>,
  proposalId: string,
  headers: Record<string, string> = {},
): Promise<Response> | Response {
  return post(
    s,
    `/api/teams/${s.team.id}/chief/threads/thread-a/questions/approval-${proposalId}/answer`,
    { answers: [{ header: '审批', choices: ['批准执行'] }] },
    { 'sec-fetch-site': 'same-origin', ...headers },
  );
}

function answerDirect(
  s: ReturnType<typeof world>,
  proposalId: string,
  headers: Record<string, string> = {},
): Promise<Response> | Response {
  return post(
    s,
    `/api/actions/proposals/${proposalId}/answer`,
    { decision: 'allow-once' },
    headers,
  );
}

const ownerHeaders = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${TOKEN}`,
  ...extra,
});

const channelHeaders = (extra: Record<string, string> = {}) => ({
  ...ownerHeaders({ [OWNER_CHANNEL_HEADER]: KEY }),
  ...extra,
});

describe('owner channel gate', () => {
  test('the loopback bootstrap route is gone', async () => {
    const s = world({ key: KEY });
    const res = await post(s, '/api/auth/bootstrap', {}, channelHeaders());
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('cairn_auth');
    s.dispose();
  });

  test('a bearer-only approval answer is refused, even with forged browser headers', async () => {
    const s = world({ key: KEY });
    const proposalId = pendingProposal(s);
    for (const headers of [
      ownerHeaders(),
      ownerHeaders({ 'sec-fetch-site': 'same-origin' }),
      ownerHeaders({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:8787' }),
      ownerHeaders({ 'sec-fetch-site': 'none' }),
    ]) {
      const res = await answer(s, proposalId, headers);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'owner channel required',
        code: 'owner-channel-required',
      });
    }
    expect(proposalById(s.db, proposalId)?.status).toBe('pending');
    s.dispose();
  });

  test('a wrong channel key is refused', async () => {
    const s = world({ key: KEY });
    const proposalId = pendingProposal(s);
    const res = await answer(s, proposalId, ownerHeaders({ [OWNER_CHANNEL_HEADER]: 'wrong' }));
    expect(res.status).toBe(403);
    expect(proposalById(s.db, proposalId)?.status).toBe('pending');
    s.dispose();
  });

  test('a stolen owner cookie still cannot answer without the channel', async () => {
    const s = world({ key: KEY });
    const proposalId = pendingProposal(s);
    const session = issueBrowserSession(s.db, 'owner');
    const res = await answer(s, proposalId, {
      cookie: `cairn_auth=${session.token}`,
      'sec-fetch-site': 'same-origin',
    });
    expect(res.status).toBe(403);
    expect(proposalById(s.db, proposalId)?.status).toBe('pending');
    s.dispose();
  });

  test('the desktop answer carries the channel and executes', async () => {
    const s = world({ key: KEY });
    const proposalId = pendingProposal(s);
    const res = await answer(s, proposalId, channelHeaders());
    expect(res.status).toBe(200);
    expect(proposalById(s.db, proposalId)?.status).toBe('executed');
    s.dispose();
  });

  test('an unestablished channel fails closed with 503', async () => {
    const s = world({ key: null });
    const proposalId = pendingProposal(s);
    const res = await answer(s, proposalId, channelHeaders());
    expect(res.status).toBe(503);
    expect(proposalById(s.db, proposalId)?.status).toBe('pending');
    s.dispose();
  });

  test('a server without a configured channel keeps bearer-only behavior', async () => {
    const s = world(undefined);
    const proposalId = pendingProposal(s);
    const res = await answer(s, proposalId, ownerHeaders());
    expect(res.status).toBe(200);
    expect(proposalById(s.db, proposalId)?.status).toBe('executed');
    s.dispose();
  });

  test('an access-exchanged owner session answers without the channel', async () => {
    const s = world({ key: KEY }, { accessVerifier: async () => ({ kind: 'invalid' }) });
    const proposalId = pendingProposal(s);
    const session = issueBrowserSession(s.db, 'external');
    const res = await answer(s, proposalId, {
      cookie: `cairn_auth=${session.token}`,
      'sec-fetch-site': 'same-origin',
    });
    expect(res.status).toBe(200);
    expect(proposalById(s.db, proposalId)?.status).toBe('executed');
    s.dispose();
  });

  test('a forged external session is refused where no access exchange exists', async () => {
    const s = world({ key: KEY });
    const session = issueBrowserSession(s.db, 'external');
    const res = await s.app.request(`/api/teams/${s.team.id}/top-models`, {
      method: 'PUT',
      headers: {
        cookie: `cairn_auth=${session.token}`,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ models: [] }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'owner channel required',
      code: 'owner-channel-required',
    });
    s.dispose();
  });

  test('a paired device answers without the channel', async () => {
    const s = world({ key: KEY });
    const issued = await post(s, '/api/remote/pairing', {}, channelHeaders());
    expect(issued.status).toBe(201);
    const { code } = (await issued.json()) as { code: string };
    const paired = await redeemTestPairing(s.app, code, 'Test phone');
    expect(paired.status).toBe(201);
    const { token: deviceToken, deviceId } = (await paired.json()) as {
      token: string;
      deviceId: string;
    };
    const proposalId = pendingProposal(s);
    const res = await answer(s, proposalId, { authorization: `Bearer ${deviceToken}` });
    expect(res.status).toBe(200);
    expect(proposalById(s.db, proposalId)).toMatchObject({
      status: 'executed',
      decidedBy: `device:${deviceId}`,
    });
    s.dispose();
  });

  test('minting a pairing code needs the channel, but listing grants is a read', async () => {
    const s = world({ key: KEY });
    const res = await post(s, '/api/remote/pairing', {}, ownerHeaders());
    expect(res.status).toBe(403);
    const revoked = await s.app.request('/api/remote/pairing/whatever', {
      method: 'DELETE',
      headers: ownerHeaders(),
    });
    expect(revoked.status).toBe(403);
    const listed = await s.app.request('/api/remote/pairing', { headers: ownerHeaders() });
    expect(listed.status).toBe(200);
    s.dispose();
  });

  test('machine enroll confirm needs the channel; enroll start stays open', async () => {
    const s = world({ key: KEY });
    const started = await post(s, '/api/machine/enroll/start', { name: 'runner' });
    expect(started.status).toBe(200);
    const { enrollId } = (await started.json()) as { enrollId: string };
    const bare = await post(s, '/api/machine/enroll/confirm', { enrollId }, ownerHeaders());
    expect(bare.status).toBe(403);
    const confirmed = await post(s, '/api/machine/enroll/confirm', { enrollId }, channelHeaders());
    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()) as { machine: { machineId: string; token: string } };
    expect(body.machine.token.length).toBeGreaterThan(0);
    s.dispose();
  });

  test('the direct proposals answer route is gated before its handler', async () => {
    const s = world({ key: KEY });
    const proposalId = pendingProposal(s);
    const bare = await answerDirect(s, proposalId, ownerHeaders());
    expect(bare.status).toBe(403);
    const admitted = await answerDirect(s, proposalId, channelHeaders());
    expect(admitted.status).toBe(409);
    expect(proposalById(s.db, proposalId)?.status).toBe('pending');
    s.dispose();
  });

  test('a stolen owner token cannot mutate the ordinary routes #4986 names', async () => {
    const s = world({ key: KEY });
    const team = s.team.id;
    const writes: Array<[string, string, unknown?]> = [
      ['DELETE', '/api/todos/todo-x', undefined],
      ['PATCH', '/api/todos/todo-x', { title: 'x' }],
      ['DELETE', '/api/projects/project-a', undefined],
      ['POST', '/api/projects', { name: 'forged', localPath: '/tmp/forged' }],
      ['POST', '/api/builds/build-x/merge', {}],
      ['DELETE', `/api/teams/${team}/secrets/sec-x`, undefined],
      ['POST', `/api/teams/${team}/secrets`, { name: 'x', value: 'y' }],
      ['PUT', `/api/teams/${team}/top-models`, { models: [] }],
      ['PATCH', `/api/teams/${team}`, { maxAutonomousMergesPerDay: 99 }],
      ['PATCH', '/api/user/me', { displayName: 'forged' }],
      ['POST', `/api/teams/${team}/devin-subscriptions`, { label: 'x', token: 'y' }],
      [
        'POST',
        '/api/uploads/grant',
        { kind: 'attachment', fileName: 'x', mimeType: 'text/plain', size: 1, scope: 'message' },
      ],
      ['POST', '/api/auth/stream-ticket', undefined],
      ['POST', '/api/schedules', { name: 'x', prompt: 'y', cron: '0 0 * * *' }],
      ['POST', '/api/actions/journal/journal-x/undo', {}],
      ['PUT', '/api/server/deploy/lease', { owner: crypto.randomUUID(), ttlMs: 1000 }],
    ];
    for (const [method, path, body] of writes) {
      const res = await s.app.request(path, {
        method,
        headers: {
          ...ownerHeaders({ 'sec-fetch-site': 'same-origin' }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(res.status, `${method} ${path} admitted a bearer-only same-uid caller`).toBe(403);
      expect(await res.json()).toEqual({
        error: 'owner channel required',
        code: 'owner-channel-required',
      });
    }
    s.dispose();
  });

  test('a bearer-only project delete leaves its pending proposal untouched', async () => {
    const s = world({ key: KEY });
    const proposalId = pendingProposal(s);
    const res = await s.app.request('/api/projects/project-a', {
      method: 'DELETE',
      headers: ownerHeaders(),
    });
    expect(res.status).toBe(403);
    expect(proposalById(s.db, proposalId)?.status).toBe('pending');
    const admitted = await s.app.request('/api/projects/project-a', {
      method: 'DELETE',
      headers: channelHeaders(),
    });
    expect(admitted.status).toBe(204);
    expect(proposalById(s.db, proposalId)?.status).toBe('executed');
    s.dispose();
  });

  test('the channel admits ordinary mutations; devices and access sessions stay exempt', async () => {
    const s = world({ key: KEY }, { accessVerifier: async () => ({ kind: 'invalid' }) });
    const ticket = await post(s, '/api/auth/stream-ticket', undefined, channelHeaders());
    expect(ticket.status).toBe(200);
    const topModels = await s.app.request(`/api/teams/${s.team.id}/top-models`, {
      method: 'PUT',
      headers: channelHeaders({
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ models: [] }),
    });
    expect(topModels.status).toBe(200);
    const issued = await post(s, '/api/remote/pairing', {}, channelHeaders());
    const { code } = (await issued.json()) as { code: string };
    const paired = await redeemTestPairing(s.app, code, 'Test phone');
    const { token: deviceToken } = (await paired.json()) as { token: string };
    const deviceTicket = await post(s, '/api/auth/stream-ticket', undefined, {
      authorization: `Bearer ${deviceToken}`,
    });
    expect(deviceTicket.status).toBe(200);
    const deviceOnOwnerOnly = await post(
      s,
      '/api/remote/pairing',
      {},
      {
        authorization: `Bearer ${deviceToken}`,
      },
    );
    expect(deviceOnOwnerOnly.status).toBe(403);
    expect(await deviceOnOwnerOnly.json()).toEqual({
      error: 'only the owner token can do this',
    });
    const access = issueBrowserSession(s.db, 'external');
    const accessWrite = await s.app.request(`/api/teams/${s.team.id}/top-models`, {
      method: 'PUT',
      headers: {
        cookie: `cairn_auth=${access.token}`,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ models: [] }),
    });
    expect(accessWrite.status).toBe(200);
    s.dispose();
  });

  test('a stolen owner cookie cannot mutate ordinary routes either', async () => {
    const s = world({ key: KEY });
    const session = issueBrowserSession(s.db, 'owner');
    const res = await s.app.request('/api/todos/todo-x', {
      method: 'DELETE',
      headers: {
        cookie: `cairn_auth=${session.token}`,
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'owner channel required',
      code: 'owner-channel-required',
    });
    s.dispose();
  });

  test('reads stay open to bearer on a configured server', async () => {
    const s = world({ key: KEY });
    for (const path of ['/api/teams', '/api/projects', `/api/teams/${s.team.id}/top-models`]) {
      const res = await s.app.request(path, { headers: ownerHeaders() });
      expect(res.status, `GET ${path}`).toBe(200);
    }
    s.dispose();
  });

  test('a channel-less server keeps ordinary bearer writes working', async () => {
    const s = world(undefined);
    const res = await s.app.request(`/api/teams/${s.team.id}/top-models`, {
      method: 'PUT',
      headers: ownerHeaders({
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ models: [] }),
    });
    expect(res.status).toBe(200);
    s.dispose();
  });

  test('POST /api/auth/session without owner channel returns structured owner-channel-required code', async () => {
    const s = world({ key: KEY });
    const res = await s.app.request('/api/auth/session', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-cairn-browser-auth': '1',
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'owner channel required',
      code: 'owner-channel-required',
    });
    s.dispose();
  });

  test('ordinary owner routes keep working on bearer alone', async () => {
    const s = world({ key: KEY });
    const res = await s.app.request('/api/teams', { headers: ownerHeaders() });
    expect(res.status).toBe(200);
    const denied = await s.app.request('/api/teams', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(denied.status).toBe(401);
    s.dispose();
  });
});

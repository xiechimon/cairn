import { type ActionEntry, OWNER_CHANNEL_HEADER } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { AppContext } from '../src/context.js';
import { chief, chiefThread, project as projectTable } from '../src/db/schema.js';
import { proposalById } from '../src/services/action-proposals.js';
import { executeAction } from '../src/services/action-registry.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { bootServer } from './helpers.js';

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

function world(ownerChannel: AppContext['ownerChannel']) {
  const s = bootServer({ authToken: TOKEN, ownerChannel });
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
      expect(await res.json()).toEqual({ error: 'owner channel required' });
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
    const s = world({ key: KEY });
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

  test('a paired device answers without the channel', async () => {
    const s = world({ key: KEY });
    const issued = await post(s, '/api/remote/pairing', {}, channelHeaders());
    expect(issued.status).toBe(201);
    const { code } = (await issued.json()) as { code: string };
    const paired = await post(s, '/api/remote/pair', { code, name: 'Test phone' });
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

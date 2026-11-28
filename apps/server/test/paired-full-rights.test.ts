import { OWNER_CHANNEL_HEADER } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chief,
  chiefThread,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { isOwnerDecider } from '../src/services/instance-owner.js';
import { deviceStreamsOf } from '../src/services/paired-devices.js';
import { createSecret } from '../src/services/secrets.js';
import { bootServer, redeemTestPairing, type TestServer } from './helpers.js';

const OWNER = 'paired-full-rights-owner-token-0123456789abcdef';
const CHANNEL_KEY = 'paired-full-rights-channel-key';
const ownerHeaders = { authorization: `Bearer ${OWNER}` };

function call(
  s: TestServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

async function pairDevice(
  s: TestServer,
  name = 'paired-mac',
  issuingHeaders: Record<string, string> = ownerHeaders,
): Promise<{ token: string; deviceId: string; cookie: string }> {
  const issued = await call(s, 'POST', '/api/remote/pairing', issuingHeaders);
  expect(issued.status).toBe(201);
  const { code } = (await issued.json()) as { code: string };
  const paired = await redeemTestPairing(s.app, code, name);
  expect(paired.status).toBe(201);
  const cookie = paired.headers.get('set-cookie')?.split(';')[0] ?? '';
  const body = (await paired.json()) as { token: string; deviceId: string };
  return { ...body, cookie };
}

describe('paired devices hold full owner rights', () => {
  test.each(['bearer', 'cookie'] as const)(
    'paired %s can delete a stale runner and set the default runner',
    async (kind) => {
      const s = bootServer({ authToken: OWNER });
      try {
        s.db
          .insert(machineTable)
          .values([
            { id: 'stale-runner', name: 'old-mac', teamId: s.team.id, tokenHash: 'hash-stale' },
            { id: 'active-runner', name: 'new-mac', teamId: s.team.id, tokenHash: 'hash-active' },
          ])
          .run();
        const paired = await pairDevice(s);
        const headers: Record<string, string> =
          kind === 'bearer'
            ? { authorization: `Bearer ${paired.token}` }
            : { cookie: paired.cookie, 'sec-fetch-site': 'same-origin' };

        const setDefault = await call(s, 'PATCH', '/api/machines/active-runner', headers, {
          isDefault: true,
        });
        expect(setDefault.status).toBe(200);
        expect(
          s.db.select().from(teamTable).where(eq(teamTable.id, s.team.id)).get()?.defaultMachineId,
        ).toBe('active-runner');

        const removed = await call(s, 'DELETE', '/api/machines/stale-runner', headers);
        expect(removed.status).toBe(204);
        expect(
          s.db.select().from(machineTable).where(eq(machineTable.id, 'stale-runner')).get(),
        ).toBeUndefined();
      } finally {
        s.dispose();
      }
    },
  );

  test('paired device token is admitted on every former owner-only route and deploy lease', async () => {
    const s = bootServer({ authToken: OWNER });
    try {
      const paired = await pairDevice(s, 'mac-a');
      const other = await pairDevice(s, 'mac-b');
      const deviceHeaders = {
        authorization: `Bearer ${paired.token}`,
        'sec-fetch-site': 'same-origin',
      };

      const createdProject = await call(s, 'POST', '/api/projects', deviceHeaders, {
        name: 'paired-deletable',
      });
      expect(createdProject.status).toBe(201);
      const { id: projectId } = (await createdProject.json()) as { id: string };

      const enrollStart = await call(
        s,
        'POST',
        '/api/machine/enroll/start',
        {},
        { name: 'runner' },
      );
      expect(enrollStart.status).toBe(200);
      const { enrollId } = (await enrollStart.json()) as { enrollId: string };

      createSecret(
        { db: s.db, box: s.secretBox },
        { teamId: s.team.id, name: 'ENV_PLAIN', value: 'visible-value', kind: 'env' },
      );

      s.db
        .insert(chief)
        .values({ id: 'chief-1', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
        .run();
      s.db
        .insert(chiefThread)
        .values({
          id: 'thread-1',
          chiefId: 'chief-1',
          userId: s.user.id,
          teamId: s.team.id,
          title: 't',
          createdAt: 1,
          updatedAt: 1,
          sessionId: 'thread-1',
          sessionOpenedAt: 1,
        })
        .run();
      s.db
        .insert(machineTable)
        .values({
          id: 'runner-online',
          name: 'studio',
          teamId: s.team.id,
          tokenHash: 'hash-online',
          online: true,
        })
        .run();
      s.db
        .insert(stepTable)
        .values({
          id: 'chief-step-1',
          buildId: 'thread-1',
          kind: 'chief',
          status: 'pending',
          prompt: 'hi',
          createdAt: 1,
        })
        .run();

      const leaseOwner = '00000000-0000-4000-8000-000000000099';
      const checks: Array<[string, string, unknown?]> = [
        ['GET', '/api/remote/pairing'],
        ['POST', '/api/remote/pairing'],
        ['GET', '/api/remote/pairing-requests'],
        ['POST', '/api/remote/tailnet', { enabled: false }],
        ['POST', '/api/remote/tailscale'],
        ['DELETE', `/api/remote/devices/${other.deviceId}`],
        ['POST', '/api/machine/enroll/confirm', { enrollId }],
        ['PATCH', `/api/teams/${s.team.id}`, { maxAutonomousMergesPerDay: 5 }],
        ['POST', `/api/teams/${s.team.id}/api-keys`, { name: 'K', machineAccess: true }],
        ['POST', `/api/teams/${s.team.id}/secrets`, { name: 'MY_SEC', value: 'secret-val' }],
        ['POST', `/api/teams/${s.team.id}/providers`, { label: 'p' }],
        ['PUT', `/api/teams/${s.team.id}/provider-order`, { order: [] }],
        ['POST', `/api/teams/${s.team.id}/providers/missing/test`, {}],
        ['GET', `/api/teams/${s.team.id}/providers/missing/upstream-models`],
        ['POST', `/api/teams/${s.team.id}/providers/runtimes/claude-code/update`],
        ['POST', `/api/teams/${s.team.id}/claude-subscriptions`, {}],
        ['POST', `/api/teams/${s.team.id}/devin-subscriptions`, {}],
        ['POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {}],
        ['POST', `/api/teams/${s.team.id}/mcp-connectors`, {}],
        ['PUT', `/api/teams/${s.team.id}/mcp-connectors/composio/key`, { key: 'k' }],
        ['PATCH', `/api/teams/${s.team.id}/routing-rules/session`, { provider: 'openai' }],
        ['PATCH', `/api/teams/${s.team.id}/work-policies/session`, { tools: [] }],
        ['POST', `/api/teams/${s.team.id}/im/telegram`, { botToken: 'x' }],
        ['GET', `/api/teams/${s.team.id}/im/wechat/login/wx_test`],
        ['POST', `/api/teams/${s.team.id}/skills/import`, { localPath: '/nonexistent-path' }],
        ['GET', `/api/teams/${s.team.id}/skills/import-candidates`],
        ['POST', '/api/skills', { name: 's1', description: 'd', files: [] }],
        ['POST', '/api/schedules', { name: 'x' }],
        ['POST', '/api/design-shares', {}],
        ['POST', '/api/todos/t1/design/index.html/share'],
        ['DELETE', `/api/teams/${s.team.id}/github/connection`],
        ['POST', '/api/computers', {}],
        ['DELETE', `/api/projects/${projectId}`],
        ['GET', '/api/server/deploy/lease'],
        ['PUT', '/api/server/deploy/lease', { owner: leaseOwner, ttlMs: 60_000 }],
        ['DELETE', '/api/server/deploy/lease', { owner: leaseOwner }],
        ['POST', '/api/server/backup/run'],
        ['POST', '/api/server/backup/export'],
        ['POST', '/api/server/backup/snap-1/restore'],
        ['POST', '/api/server/backup/import'],
        ['PUT', `/api/teams/${s.team.id}/top-models`, { models: [] }],
        ['GET', '/api/actions/journal'],
        ['GET', '/api/actions/proposals'],
        ['GET', '/api/fs/list'],
        ['GET', `/api/teams/${s.team.id}/browser-password-grants`],
        ['GET', '/api/phones/handoffs'],
        ['POST', `/api/teams/${s.team.id}/mail/accounts`, {}],
        ['POST', '/api/chief/steps/chief-step-1/switch-machine', { machineId: 'runner-online' }],
      ];

      for (const [method, path, body] of checks) {
        const res = await call(s, method, path, deviceHeaders, body);
        expect(res.status, `${method} ${path} should not be 403`).not.toBe(403);
        expect(res.status, `${method} ${path} should not be 401`).not.toBe(401);
      }

      const secretsRes = await call(s, 'GET', `/api/teams/${s.team.id}/secrets`, deviceHeaders);
      expect(secretsRes.status).toBe(200);
      const secrets = (await secretsRes.json()) as Array<{
        name: string;
        value?: string;
        redacted?: boolean;
      }>;
      const envRow = secrets.find((row) => row.name === 'ENV_PLAIN');
      expect(envRow?.value).toBe('visible-value');
      expect(envRow?.redacted).toBeUndefined();

      const providersRes = await call(s, 'GET', `/api/teams/${s.team.id}/providers`, deviceHeaders);
      expect(providersRes.status).toBe(200);
      expect(
        ((await providersRes.json()) as { canTestConnection?: boolean }).canTestConnection,
      ).toBe(true);
    } finally {
      s.dispose();
    }
  });

  test('revoking a paired device immediately rejects its bearer token, cookie, and stream ticket', async () => {
    const s = bootServer({ authToken: OWNER });
    try {
      const macA = await pairDevice(s, 'mac-a');
      const macB = await pairDevice(s, 'mac-b');
      const aHeaders = { authorization: `Bearer ${macA.token}` };
      const bHeaders = { authorization: `Bearer ${macB.token}` };

      const ticketRes = await call(s, 'POST', '/api/auth/stream-ticket', bHeaders);
      expect(ticketRes.status).toBe(200);
      const { ticket } = (await ticketRes.json()) as { ticket: string };

      const revokeRes = await call(s, 'DELETE', `/api/remote/devices/${macB.deviceId}`, aHeaders);
      expect(revokeRes.status).toBe(204);

      expect((await call(s, 'GET', '/api/teams', bHeaders)).status).toBe(401);
      expect((await call(s, 'DELETE', '/api/machines/any', bHeaders)).status).toBe(401);
      expect((await call(s, 'GET', '/api/teams', { cookie: macB.cookie })).status).toBe(401);
      expect(
        (
          await call(s, 'DELETE', '/api/machines/any', {
            cookie: macB.cookie,
            'sec-fetch-site': 'same-origin',
          })
        ).status,
      ).toBe(401);
      expect(
        (await call(s, 'GET', `/api/teams/${s.team.id}/stream?ticket=${ticket}`, {})).status,
      ).toBe(401);
    } finally {
      s.dispose();
    }
  });

  test('paired device writes work on an IPC owner-channel server while bare owner token stays blocked', async () => {
    const s = bootServer({ authToken: OWNER, ownerChannel: { key: CHANNEL_KEY } });
    try {
      s.db
        .insert(machineTable)
        .values({ id: 'stale-ipc', name: 'old', teamId: s.team.id, tokenHash: 'hash' })
        .run();
      const channelHeaders = {
        ...ownerHeaders,
        [OWNER_CHANNEL_HEADER]: CHANNEL_KEY,
      };
      const paired = await pairDevice(s, 'remote-mac', channelHeaders);
      const bareOwnerDelete = await call(s, 'DELETE', '/api/machines/stale-ipc', ownerHeaders);
      expect(bareOwnerDelete.status).toBe(403);

      const pairedDelete = await call(s, 'DELETE', '/api/machines/stale-ipc', {
        authorization: `Bearer ${paired.token}`,
      });
      expect(pairedDelete.status).toBe(204);
    } finally {
      s.dispose();
    }
  });

  test('paired device discloses localPath on local projects', async () => {
    const s = bootServer({ authToken: OWNER });
    try {
      s.db
        .insert(projectTable)
        .values({
          id: 'local-proj',
          name: 'Local',
          teamId: s.team.id,
          repoKind: 'local',
          localPath: '/tmp/cairn-local-proj',
        })
        .run();
      const paired = await pairDevice(s);
      const res = await call(s, 'GET', `/api/projects?teamId=${s.team.id}`, {
        authorization: `Bearer ${paired.token}`,
      });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<{ id: string; localPath?: string }>;
      expect(rows.find((row) => row.id === 'local-proj')?.localPath).toBe('/tmp/cairn-local-proj');
    } finally {
      s.dispose();
    }
  });

  test('isOwnerDecider enforces active team-scoped device and DeviceStreamRegistry closes late binds on revoked devices', async () => {
    const s = bootServer({ authToken: OWNER });
    try {
      const paired = await pairDevice(s, 'decider-mac');
      expect(isOwnerDecider(s.db, s.user.id, s.team.id)).toBe(true);
      expect(isOwnerDecider(s.db, `device:${paired.deviceId}`, s.team.id)).toBe(true);
      expect(isOwnerDecider(s.db, `device:${paired.deviceId}`, 'other-team')).toBe(false);
      expect(isOwnerDecider(s.db, 'device:', s.team.id)).toBe(false);
      expect(isOwnerDecider(s.db, 'im:sender-1', s.team.id)).toBe(false);

      const revoked = await call(
        s,
        'DELETE',
        `/api/remote/devices/${paired.deviceId}`,
        ownerHeaders,
      );
      expect(revoked.status).toBe(204);
      expect(isOwnerDecider(s.db, `device:${paired.deviceId}`, s.team.id)).toBe(false);

      let closed = false;
      deviceStreamsOf(s.db).bind(paired.deviceId, () => {
        closed = true;
      });
      expect(closed).toBe(true);
    } finally {
      s.dispose();
    }
  });
});

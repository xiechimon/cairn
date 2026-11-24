import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  browserSession,
  build,
  machine,
  pairedDevice,
  pairingGrant,
  phone,
  plan,
  schedule,
  step,
  todo,
} from '../src/db/schema.js';
import { SESSION_COOKIE } from '../src/routes-helpers.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { redeemTestPairing } from './helpers.js';
import {
  fixtureRequest,
  type ScopeTeam,
  type ScopeWorld,
  snapshotTeam,
  twoTeamWorld,
} from './team-scope-world.js';

let world: ScopeWorld;

beforeEach(async () => {
  world = await twoTeamWorld();
}, 20_000);

function asOwner(team: ScopeTeam, method: string, path: string, body?: unknown) {
  return fixtureRequest(team.server, method, path, { bearer: team.ownerToken, body });
}

async function readResponse(response: Response) {
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    return 'event-stream';
  }
  const body = await response.text();
  return body === '' ? null : JSON.parse(body);
}

const reads = [
  ['project task list', 'projectId', '/api/projects/:id/todos'],
  ['project build list', 'projectId', '/api/projects/:id/builds'],
  ['task detail', 'todoId', '/api/todos/:id'],
  ['build detail', 'buildId', '/api/builds/:id'],
  ['build steps', 'buildId', '/api/builds/:id/steps'],
  ['build usage', 'buildId', '/api/builds/:id/usage'],
  ['build plans', 'buildId', '/api/builds/:id/plans'],
  ['build merge permission', 'buildId', '/api/builds/:id/merge-permission'],
  ['build conversation history', 'buildId', '/api/conversations/:id/messages'],
  ['projectless Chief conversation history', 'threadId', '/api/conversations/:id/messages'],
  ['standalone build stream', 'buildId', '/api/conversations/:id/stream'],
  ['plan diff', 'planId', '/api/documents/:id/diff'],
  ['runner phone list', 'runnerId', '/api/machines/:id/phones'],
  ['runner phone activity', 'runnerId', '/api/machines/:id/phones/activity'],
  ['task designs', 'todoId', '/api/todos/:id/design'],
] as const;

describe('owned and missing resource responses', () => {
  it.each(reads)('%s reads the exact owned parent', async (_name, key, route) => {
    const { a, b } = world;
    for (const [owner, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const response = await asOwner(owner, 'GET', route.replace(':id', owner[key]));
      if (key === 'runnerId' && owner === b) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'owner session required' });
        continue;
      }
      expect(response.status).toBe(200);
      const body = await readResponse(response);
      expect(JSON.stringify(body)).not.toContain(other[key]);
    }
  });

  for (const [name, key, route] of reads) {
    const leak = route.endsWith('/design')
      ? null
      : key === 'runnerId'
        ? 'foreign team identity in the missing response'
        : route.endsWith('/stream')
          ? 'a stream subscription without an owned parent'
          : route.endsWith('/usage')
            ? 'foreign build existence'
            : 'foreign resource data';
    const regression = leak === null ? it : it.fails;
    const title =
      leak === null
        ? `${name} treats foreign and missing parents alike`
        : `${name} exposes ${leak}`;
    regression(title, async () => {
      const { a, b } = world;
      const before = snapshotTeam(world, b);
      const missing = await asOwner(a, 'GET', route.replace(':id', 'fixture-missing'));
      const foreign = await asOwner(a, 'GET', route.replace(':id', b[key]));
      const missingBody = await readResponse(missing);
      const foreignBody = await readResponse(foreign);
      expect({
        missing: missing.status,
        foreign: foreign.status,
        body: JSON.stringify(foreignBody),
        rows: snapshotTeam(world, b),
      }).toEqual({
        missing: 404,
        foreign: 404,
        body: JSON.stringify(missingBody).replaceAll('fixture-missing', b[key]),
        rows: before,
      });
    });
  }
});

const writes = [
  {
    name: 'project rename',
    key: 'projectId',
    route: '/api/projects/:id',
    method: 'PATCH',
    body: { name: 'renamed' },
    status: 200,
  },
  {
    name: 'project archive',
    key: 'projectId',
    route: '/api/projects/:id/archive',
    method: 'POST',
    status: 200,
  },
  {
    name: 'task rename',
    key: 'todoId',
    route: '/api/todos/:id',
    method: 'PATCH',
    body: { title: 'renamed' },
    status: 200,
  },
  {
    name: 'task archive',
    key: 'todoId',
    route: '/api/todos/:id/archive',
    method: 'POST',
    status: 200,
  },
  { name: 'task delete', key: 'todoId', route: '/api/todos/:id', method: 'DELETE', status: 204 },
  {
    name: 'runner rename',
    key: 'runnerId',
    route: '/api/machines/:id',
    method: 'PATCH',
    body: { name: 'renamed' },
    status: 200,
  },
  {
    name: 'runner revoke',
    key: 'runnerId',
    route: '/api/machines/:id/revoke',
    method: 'POST',
    status: 204,
  },
  {
    name: 'schedule disable',
    key: 'scheduleId',
    route: '/api/schedules/:id',
    method: 'PATCH',
    body: { enabled: false },
    status: 200,
  },
  {
    name: 'schedule delete',
    key: 'scheduleId',
    route: '/api/schedules/:id',
    method: 'DELETE',
    status: 204,
  },
] as const;

describe('owned and missing resource mutations', () => {
  it.each(
    writes.flatMap((operation) => (['a', 'b'] as const).map((owner) => ({ ...operation, owner }))),
  )('$name changes only its own fixture ($owner)', async (operation) => {
    const { name, key, route, method, status, owner } = operation;
    const a = world[owner];
    const b = world[owner === 'a' ? 'b' : 'a'];
    const priorA = snapshotTeam(world, a);
    const priorB = snapshotTeam(world, b);
    const response = await asOwner(
      a,
      method,
      route.replace(':id', a[key]),
      'body' in operation ? operation.body : undefined,
    );
    expect(response.status).toBe(status);
    const after = snapshotTeam(world, a);
    switch (name) {
      case 'project rename':
        expect(after.project?.name).toBe('renamed');
        break;
      case 'project archive':
        expect(after.project?.archivedAt).not.toBeNull();
        break;
      case 'task rename':
        expect(after.todo?.title).toBe('renamed');
        break;
      case 'task archive':
        expect(after.todo?.archivedAt).not.toBeNull();
        break;
      case 'task delete':
        expect(after.todo).toBeUndefined();
        break;
      case 'runner rename':
        expect(after.runner?.name).toBe('renamed');
        break;
      case 'runner revoke':
        expect(after.runner?.tokenHash).toBeNull();
        break;
      case 'schedule disable':
        expect(after.schedule?.enabled).toBe(false);
        break;
      case 'schedule delete':
        expect(after.schedule).toBeUndefined();
        break;
    }
    expect(after).not.toEqual(priorA);
    expect(snapshotTeam(world, b)).toEqual(priorB);
  });

  for (const operation of writes) {
    const { name, key, route, method } = operation;
    const leak =
      key === 'runnerId'
        ? 'foreign runner existence in the error response'
        : name === 'project archive' || key === 'scheduleId'
          ? null
          : 'a write to a foreign row';
    const regression = leak === null ? it : it.fails;
    regression(
      leak === null ? `${name} denies foreign targets` : `${name} allows ${leak}`,
      async () => {
        const { a, b } = world;
        const priorA = snapshotTeam(world, a);
        const priorB = snapshotTeam(world, b);
        const body = 'body' in operation ? operation.body : undefined;
        const missing = await asOwner(a, method, route.replace(':id', 'fixture-missing'), body);
        const foreign = await asOwner(a, method, route.replace(':id', b[key]), body);
        expect({
          missing: missing.status,
          foreign: foreign.status,
          body: JSON.stringify(await readResponse(foreign)),
          a: snapshotTeam(world, a),
          b: snapshotTeam(world, b),
        }).toEqual({
          missing: 404,
          foreign: 404,
          body: JSON.stringify(await readResponse(missing)).replaceAll('fixture-missing', b[key]),
          a: priorA,
          b: priorB,
        });
      },
    );
  }
});

describe('legacy contradictory parent chains', () => {
  it('lists each owned project’s task and build', async () => {
    const { a, b } = world;
    for (const team of [a, b]) {
      const tasks = await asOwner(team, 'GET', `/api/projects/${team.projectId}/todos`);
      const builds = await asOwner(team, 'GET', `/api/projects/${team.projectId}/builds`);
      expect(tasks.status).toBe(200);
      expect(builds.status).toBe(200);
      expect(await tasks.json()).toEqual([expect.objectContaining({ id: team.todoId })]);
      expect(await builds.json()).toEqual([expect.objectContaining({ id: team.buildId })]);
    }
  });

  it('lists a valid schedule only in its own team', async () => {
    const { a, b } = world;
    const response = await asOwner(a, 'GET', '/api/schedules');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([expect.objectContaining({ id: a.scheduleId })]);
    expect(snapshotTeam(world, b).schedule?.enabled).toBe(true);
  });

  it.fails('project child lists leak foreign tasks and builds through a contradictory project link', async () => {
    const { a, b, db } = world;
    db.update(todo).set({ projectId: a.projectId }).where(eq(todo.id, b.todoId)).run();
    const tasks = await asOwner(a, 'GET', `/api/projects/${a.projectId}/todos`);
    const builds = await asOwner(a, 'GET', `/api/projects/${a.projectId}/builds`);
    expect(tasks.status).toBe(200);
    expect(builds.status).toBe(200);
    expect(await tasks.json()).toEqual([expect.objectContaining({ id: a.todoId })]);
    expect(await builds.json()).toEqual([expect.objectContaining({ id: a.buildId })]);
  });

  it.fails('schedule list leaks a contradictory foreign project link', async () => {
    const { a, b, db } = world;
    db.update(schedule).set({ projectId: b.projectId }).where(eq(schedule.id, a.scheduleId)).run();
    const response = await asOwner(a, 'GET', '/api/schedules');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it.fails('phone handback clears a foreign phone on a contradictory host link', async () => {
    const { a, b, db } = world;
    db.update(phone).set({ machineId: a.runnerId }).where(eq(phone.id, b.phoneId)).run();
    const prior = snapshotTeam(world, b);
    const response = await asOwner(
      a,
      'POST',
      `/api/machines/${a.runnerId}/phones/${b.phoneId}/handback`,
    );
    expect({ status: response.status, foreign: snapshotTeam(world, b) }).toEqual({
      status: 404,
      foreign: prior,
    });
  });

  it('lists a phone under its exact team and runner', async () => {
    const { a, b } = world;
    const response = await asOwner(a, 'GET', `/api/machines/${a.runnerId}/phones`);
    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).toContain(a.phoneId);
    expect(body).not.toContain(b.phoneId);
  });

  it('clears a phone handoff on its exact own host without changing the other one', async () => {
    const { a, b } = world;
    const before = snapshotTeam(world, b);
    const response = await asOwner(
      a,
      'POST',
      `/api/machines/${a.runnerId}/phones/${a.phoneId}/handback`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(snapshotTeam(world, a).phone?.handoffReason).toBeNull();
    expect(snapshotTeam(world, b)).toEqual(before);
  });
});

describe('plan and build binding', () => {
  it('pauses only the current plan on the exact build', async () => {
    const { a, b, db } = world;
    for (const team of [a, b])
      db.update(todo).set({ phase: 'confirm' }).where(eq(todo.id, team.todoId)).run();
    const pause = (planId: string) =>
      asOwner(a, 'POST', `/api/builds/${a.buildId}/plans/${planId}/pause-auto-approve`);
    const foreign = () => db.select().from(plan).where(eq(plan.id, b.planId)).get();
    const before = foreign();
    expect((await pause(b.planId)).status).toBe(404);
    expect(foreign()).toEqual(before);
    const allowed = await pause(a.planId);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      id: a.planId,
      autoApprovePausedAt: expect.any(Number),
    });
    expect(foreign()).toEqual(before);
  });

  it('pauses a matching build and plan pair through its owning listener', async () => {
    const { a, b, db } = world;
    db.update(todo).set({ phase: 'confirm' }).where(eq(todo.id, b.todoId)).run();
    const before = snapshotTeam(world, a);
    const result = await asOwner(
      b,
      'POST',
      `/api/builds/${b.buildId}/plans/${b.planId}/pause-auto-approve`,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      id: b.planId,
      autoApprovePausedAt: expect.any(Number),
    });
    expect(snapshotTeam(world, a)).toEqual(before);
  });

  it.fails('plan mutation accepts a matching foreign build and plan pair', async () => {
    const { a, b, db } = world;
    db.update(todo).set({ phase: 'confirm' }).where(eq(todo.id, b.todoId)).run();
    const foreign = () => db.select().from(plan).where(eq(plan.id, b.planId)).get();
    const before = foreign();
    const result = await asOwner(
      a,
      'POST',
      `/api/builds/${b.buildId}/plans/${b.planId}/pause-auto-approve`,
    );
    expect({ status: result.status, plan: foreign() }).toEqual({ status: 404, plan: before });
  });
});

describe('listener credential admission', () => {
  it.each(['owner bearer', 'device bearer', 'device cookie'] as const)(
    '%s opens its own team on both listeners',
    async (kind) => {
      const { a, b } = world;
      for (const team of [a, b]) {
        const credential =
          kind === 'owner bearer'
            ? { bearer: team.ownerToken }
            : kind === 'device bearer'
              ? { bearer: team.deviceToken }
              : { headers: { cookie: team.deviceCookie } };
        const result = await fixtureRequest(team.server, 'GET', '/api/user/me', credential);
        expect(result.status).toBe(200);
        expect(await result.json()).toMatchObject({ id: team.userId });
      }
    },
  );

  it('rejects a wrong-listener owner bearer and an identity-only cookie', async () => {
    const { a, b } = world;
    for (const credential of [
      { bearer: b.ownerToken },
      { headers: { cookie: `${SESSION_COOKIE}=${a.userId}` } },
    ]) {
      const response = await fixtureRequest(a.server, 'GET', '/api/user/me', credential);
      expect(response.status).toBe(401);
    }
  });

  it('rejects a paired device at an owner-only surface', async () => {
    const { a } = world;
    const response = await fixtureRequest(a.server, 'POST', '/api/remote/pairing', {
      bearer: a.deviceToken,
    });
    expect(response.status).toBe(403);
  });

  it('rejects a device cookie write without same-origin proof', async () => {
    const { a } = world;
    const response = await fixtureRequest(a.server, 'PATCH', '/api/user/me', {
      headers: { cookie: a.deviceCookie, 'sec-fetch-site': 'cross-site' },
      body: { displayName: 'changed' },
    });
    expect(response.status).toBe(403);
    expect(a.server.user.displayName).toBe(a.userId);
  });

  it('accepts the same device cookie write with same-origin proof', async () => {
    const { a } = world;
    const response = await fixtureRequest(a.server, 'PATCH', '/api/user/me', {
      headers: { cookie: a.deviceCookie, 'sec-fetch-site': 'same-origin' },
      body: { displayName: 'changed' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: a.userId, displayName: 'changed' });
    expect(a.server.user.displayName).toBe('changed');
  });

  it('rejects a revoked device bearer and cookie', async () => {
    const { a, b } = world;
    for (const credential of [{ bearer: a.deviceToken }, { headers: { cookie: a.deviceCookie } }]) {
      expect((await fixtureRequest(a.server, 'GET', '/api/user/me', credential)).status).toBe(200);
    }
    const revoked = await asOwner(a, 'DELETE', `/api/remote/devices/${a.deviceId}`);
    expect(revoked.status).toBe(204);
    for (const credential of [{ bearer: a.deviceToken }, { headers: { cookie: a.deviceCookie } }]) {
      const response = await fixtureRequest(a.server, 'GET', '/api/user/me', credential);
      expect(response.status).toBe(401);
    }
    expect(
      (await fixtureRequest(b.server, 'GET', '/api/user/me', { bearer: b.deviceToken })).status,
    ).toBe(200);
  });

  it.fails('foreign device bearer opens the wrong listener and updates last-seen', async () => {
    const { a, b, db } = world;
    const current = () =>
      db.select().from(pairedDevice).where(eq(pairedDevice.id, b.deviceId)).get();
    const before = current();
    const response = await fixtureRequest(a.server, 'GET', '/api/user/me', {
      bearer: b.deviceToken,
    });
    expect({ status: response.status, device: current() }).toEqual({ status: 401, device: before });
  });

  it.fails('foreign device cookie opens the wrong listener', async () => {
    const { a, b } = world;
    const response = await fixtureRequest(a.server, 'GET', '/api/user/me', {
      headers: { cookie: b.deviceCookie },
    });
    expect(response.status).toBe(401);
  });

  it('admits a valid legacy owner browser session on the selected listener', async () => {
    const { b, db } = world;
    const { token } = issueBrowserSession(db, 'owner');
    const admitted = await fixtureRequest(b.server, 'GET', '/api/user/me', {
      headers: { cookie: `cairn_auth=${token}` },
    });
    expect(admitted.status).toBe(200);
    expect(await admitted.json()).toMatchObject({ id: b.userId });
  });

  it('issues external browser cookies usable on their own listeners', async () => {
    const { a, b } = world;
    for (const [team, suffix] of [
      [a, 'a'],
      [b, 'b'],
    ] as const) {
      const issued = await fixtureRequest(team.server, 'POST', '/api/auth/access', {
        headers: { 'cf-access-jwt-assertion': `fixture-access-${suffix}` },
      });
      expect(issued.status).toBe(200);
      const cookie = issued.headers
        .getSetCookie()
        .find((value) => value.startsWith('cairn_auth='))
        ?.split(';')[0];
      expect(cookie).toBeDefined();
      const admitted = await fixtureRequest(team.server, 'GET', '/api/user/me', {
        headers: { cookie: cookie ?? '' },
      });
      expect(admitted.status).toBe(200);
      expect(await admitted.json()).toMatchObject({ id: team.userId });
    }
  });

  it('rejects expired browser sessions without accepting their display cookies', async () => {
    const { a, db } = world;
    const expired = issueBrowserSession(db, 'owner', null, Date.now(), Date.now() - 1);
    const response = await fixtureRequest(a.server, 'GET', '/api/user/me', {
      headers: { cookie: `cairn_auth=${expired.token}; ${SESSION_COOKIE}=${a.userId}` },
    });
    expect(response.status).toBe(401);
  });

  it.fails('owner browser cookie opens the wrong listener', async () => {
    const { a, b, db } = world;
    const session = issueBrowserSession(db, 'owner');
    const credential = { headers: { cookie: `cairn_auth=${session.token}` } };
    const admitted = await fixtureRequest(b.server, 'GET', '/api/user/me', credential);
    expect(admitted.status).toBe(200);
    expect(await admitted.json()).toMatchObject({ id: b.userId });
    expect((await fixtureRequest(a.server, 'GET', '/api/user/me', credential)).status).toBe(401);
  });

  it.fails('external browser cookie opens the wrong listener', async () => {
    const { a, b } = world;
    const issued = await fixtureRequest(b.server, 'POST', '/api/auth/access', {
      headers: { 'cf-access-jwt-assertion': 'fixture-access-b' },
    });
    expect(issued.status).toBe(200);
    const cookie = issued.headers
      .getSetCookie()
      .find((value) => value.startsWith('cairn_auth='))
      ?.split(';')[0];
    expect(cookie).toBeDefined();
    const credential = { headers: { cookie: cookie ?? '' } };
    const admitted = await fixtureRequest(b.server, 'GET', '/api/user/me', credential);
    expect(admitted.status).toBe(200);
    expect(await admitted.json()).toMatchObject({ id: b.userId });
    expect((await fixtureRequest(a.server, 'GET', '/api/user/me', credential)).status).toBe(401);
  });

  it.fails('foreign pairing grant is consumed and creates a device on the wrong listener', async () => {
    const { a, b, db } = world;
    const issued = await asOwner(b, 'POST', '/api/remote/pairing');
    expect(issued.status).toBe(201);
    const { id, code } = (await issued.json()) as { id: string; code: string };
    const current = () => db.select().from(pairingGrant).where(eq(pairingGrant.id, id)).get();
    const before = current();
    const devices = db.select().from(pairedDevice).all();
    const sessions = db.select().from(browserSession).all();
    const mismatch = await redeemTestPairing(a.server.app, code, 'authorized fixture');
    const after = {
      status: mismatch.status,
      grant: current(),
      devices: db.select().from(pairedDevice).all(),
      sessions: db.select().from(browserSession).all(),
    };
    const ownerPair = await redeemTestPairing(b.server.app, code, 'authorized fixture');
    expect({ ...after, ownerPair: ownerPair.status }).toEqual({
      status: 401,
      grant: before,
      devices,
      sessions,
      ownerPair: 201,
    });
  });

  it('rejects pairing grant replay and expiry', async () => {
    const { a, db } = world;
    const issued = await asOwner(a, 'POST', '/api/remote/pairing');
    const { code } = (await issued.json()) as { code: string };
    const pair = () => redeemTestPairing(a.server.app, code, 'test device');
    expect((await pair()).status).toBe(201);
    expect((await pair()).status).toBe(401);
    const expiring = await asOwner(a, 'POST', '/api/remote/pairing');
    const { id, code: expiredCode } = (await expiring.json()) as { id: string; code: string };
    db.update(pairingGrant).set({ expiresAt: 1 }).where(eq(pairingGrant.id, id)).run();
    const prior = db.select().from(pairedDevice).all();
    const result = await redeemTestPairing(a.server.app, expiredCode, 'expired');
    expect(result.status).toBe(401);
    expect(db.select().from(pairedDevice).all()).toEqual(prior);
  });

  it('lists and redeems a pairing grant on its issuing listener', async () => {
    const { b, db } = world;
    const issued = await asOwner(b, 'POST', '/api/remote/pairing');
    expect(issued.status).toBe(201);
    const { id, code } = (await issued.json()) as { id: string; code: string };
    const listed = await asOwner(b, 'GET', '/api/remote/pairing');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toContainEqual(expect.objectContaining({ id }));

    const paired = await redeemTestPairing(b.server.app, code, 'authorized fixture');
    expect(paired.status).toBe(201);
    const { deviceId } = (await paired.json()) as { deviceId: string };
    const device = db.select().from(pairedDevice).where(eq(pairedDevice.id, deviceId)).get();
    expect(device?.teamId).toBe(b.teamId);
  });

  it.fails('pairing grant list leaks foreign grants', async () => {
    const { a, b } = world;
    const issuedA = await asOwner(a, 'POST', '/api/remote/pairing');
    const issuedB = await asOwner(b, 'POST', '/api/remote/pairing');
    const { id: own } = (await issuedA.json()) as { id: string };
    const { id: foreign } = (await issuedB.json()) as { id: string };
    const list = await asOwner(a, 'GET', '/api/remote/pairing');
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string }[];
    expect(rows.map(({ id }) => id)).toContain(own);
    expect(rows.map(({ id }) => id)).not.toContain(foreign);
  });

  it('keeps a stream ticket stream-only and single-use', async () => {
    const { a } = world;
    const issue = await fixtureRequest(a.server, 'POST', '/api/auth/stream-ticket', {
      bearer: a.deviceToken,
    });
    expect(issue.status).toBe(200);
    const { ticket } = (await issue.json()) as { ticket: string };
    const wrongPurpose = await fixtureRequest(a.server, 'PATCH', `/api/user/me?ticket=${ticket}`, {
      body: { displayName: 'changed' },
    });
    expect(wrongPurpose.status).toBe(401);
    const open = () =>
      fixtureRequest(a.server, 'GET', `/api/teams/${a.teamId}/stream?ticket=${ticket}`);
    const response = await open();
    expect(response.status).toBe(200);
    expect(await readResponse(response)).toBe('event-stream');
    expect((await open()).status).toBe(401);
  });

  it.fails('wrong stream destination consumes a valid ticket before admission', async () => {
    const { a, b } = world;
    const issue = await fixtureRequest(a.server, 'POST', '/api/auth/stream-ticket', {
      bearer: a.deviceToken,
    });
    expect(issue.status).toBe(200);
    const { ticket } = (await issue.json()) as { ticket: string };
    const wrong = await fixtureRequest(
      a.server,
      'GET',
      `/api/teams/${b.teamId}/stream?ticket=${ticket}`,
    );
    expect(wrong.status).toBe(404);
    const own = await fixtureRequest(
      a.server,
      'GET',
      `/api/teams/${a.teamId}/stream?ticket=${ticket}`,
    );
    expect(own.status).toBe(200);
    expect(await readResponse(own)).toBe('event-stream');
  });

  it('leaves a revoked device stream ticket unusable', async () => {
    const { a } = world;
    const issued = await fixtureRequest(a.server, 'POST', '/api/auth/stream-ticket', {
      bearer: a.deviceToken,
    });
    expect(issued.status).toBe(200);
    const { ticket } = (await issued.json()) as { ticket: string };
    expect((await asOwner(a, 'DELETE', `/api/remote/devices/${a.deviceId}`)).status).toBe(204);
    const response = await fixtureRequest(
      a.server,
      'GET',
      `/api/teams/${a.teamId}/stream?ticket=${ticket}`,
    );
    expect(response.status).toBe(401);
  });
});

describe('runner enrollment and operations', () => {
  it('enrolls an API key only for its own team', async () => {
    const { a, b, db } = world;
    const enroll = (teamId: string) =>
      fixtureRequest(a.server, 'POST', '/api/machine/enroll', {
        bearer: a.keyToken,
        body: { teamId, name: 'fixture-enrolled' },
      });
    const before = db.select().from(machine).all();
    expect((await enroll(b.teamId)).status).toBe(401);
    expect(db.select().from(machine).all()).toEqual(before);
    const own = await enroll(a.teamId);
    expect(own.status).toBe(200);
    const { machineId } = (await own.json()) as { machineId: string };
    expect(db.select().from(machine).where(eq(machine.id, machineId)).get()?.teamId).toBe(a.teamId);
  });

  it('enrolls the foreign-listener control through the key’s owning listener', async () => {
    const { a, b, db } = world;
    const before = snapshotTeam(world, a);
    const response = await fixtureRequest(b.server, 'POST', '/api/machine/enroll', {
      bearer: b.keyToken,
      body: { teamId: b.teamId, name: 'fixture-other-listener' },
    });
    expect(response.status).toBe(200);
    const { machineId } = (await response.json()) as { machineId: string };
    expect(db.select().from(machine).where(eq(machine.id, machineId)).get()).toMatchObject({
      teamId: b.teamId,
      name: 'fixture-other-listener',
    });
    expect(snapshotTeam(world, a)).toEqual(before);
  });

  it.fails('foreign enrollment key creates a runner through the wrong listener', async () => {
    const { a, b, db } = world;
    const before = db.select().from(machine).all();
    const response = await fixtureRequest(a.server, 'POST', '/api/machine/enroll', {
      bearer: b.keyToken,
      body: { teamId: b.teamId, name: 'fixture-other-listener' },
    });
    expect({ status: response.status, runners: db.select().from(machine).all() }).toEqual({
      status: 401,
      runners: before,
    });
  });

  it('does not admit a runner bearer to a browser surface', async () => {
    const { a, b } = world;
    for (const team of [a, b]) {
      const response = await fixtureRequest(team.server, 'GET', '/api/user/me', {
        bearer: team.runnerToken,
      });
      expect(response.status).toBe(401);
    }
  });

  it.fails('interactive enrollment start creates a challenge for a foreign team', async () => {
    const { a, b } = world;
    const foreign = await fixtureRequest(a.server, 'POST', '/api/machine/enroll/start', {
      body: { teamId: b.teamId, name: 'authorized fixture' },
    });
    expect(foreign.status).toBe(404);
  });

  it('starts enrollment with the current listener’s explicit team', async () => {
    const { a, b } = world;
    for (const team of [a, b]) {
      const response = await fixtureRequest(team.server, 'POST', '/api/machine/enroll/start', {
        body: { teamId: team.teamId, name: 'authorized fixture' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ enrollId: expect.any(String) });
    }
  });

  it('confirms and polls a same-listener enrollment without affecting the other team', async () => {
    const { a, b } = world;
    const prior = snapshotTeam(world, b);
    const start = await fixtureRequest(a.server, 'POST', '/api/machine/enroll/start', {
      body: { name: 'authorized fixture' },
    });
    expect(start.status).toBe(200);
    const { enrollId } = (await start.json()) as { enrollId: string };
    const confirm = await asOwner(a, 'POST', '/api/machine/enroll/confirm', { enrollId });
    expect(confirm.status).toBe(200);
    const poll = await fixtureRequest(a.server, 'POST', '/api/machine/enroll/poll', {
      body: { enrollId },
    });
    expect(await poll.json()).toMatchObject({ status: 'authorized' });
    const other = await fixtureRequest(b.server, 'POST', '/api/machine/enroll/poll', {
      body: { enrollId },
    });
    expect(await other.json()).toEqual({ status: 'expired' });
    expect(snapshotTeam(world, b)).toEqual(prior);
  });

  it('heartbeats update a claimed step under its real task and build', async () => {
    const { a, b } = world;
    for (const [owner, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const before = snapshotTeam(world, other);
      const response = await fixtureRequest(
        owner.server,
        'POST',
        `/api/machine/heartbeat/${owner.stepId}`,
        {
          bearer: owner.runnerToken,
          body: {},
        },
      );
      expect(response.status).toBe(200);
      expect(snapshotTeam(world, owner).step?.lastHeartbeatAt).toEqual(expect.any(Number));
      expect(snapshotTeam(world, other)).toEqual(before);
    }
  });

  it.fails('heartbeat exposes foreign step existence in a distinct error response', async () => {
    const { a, b } = world;
    const prior = snapshotTeam(world, b);
    const beat = (id: string) =>
      fixtureRequest(a.server, 'POST', `/api/machine/heartbeat/${id}`, {
        bearer: a.runnerToken,
        body: {},
      });
    const missing = await beat('fixture-missing');
    const foreign = await beat(b.stepId);
    expect(missing.status).toBe(410);
    expect({
      status: foreign.status,
      body: JSON.stringify(await foreign.json()),
      foreign: snapshotTeam(world, b),
    }).toEqual({
      status: 410,
      body: JSON.stringify(await missing.json()).replaceAll('fixture-missing', b.stepId),
      foreign: prior,
    });
  });

  it.fails('assignment-only step lookup writes a heartbeat under a foreign conversation', async () => {
    const { a, b, db } = world;
    db.update(step).set({ buildId: b.buildId }).where(eq(step.id, a.stepId)).run();
    const prior = snapshotTeam(world, a);
    const response = await fixtureRequest(a.server, 'POST', `/api/machine/heartbeat/${a.stepId}`, {
      bearer: a.runnerToken,
      body: {},
    });
    expect({ status: response.status, local: snapshotTeam(world, a) }).toEqual({
      status: 410,
      local: prior,
    });
  });

  it.fails('heartbeat accepts a stale foreign project parent', async () => {
    const { a, b, db } = world;
    db.update(todo).set({ projectId: b.projectId }).where(eq(todo.id, a.todoId)).run();
    const prior = snapshotTeam(world, a);
    const response = await fixtureRequest(a.server, 'POST', `/api/machine/heartbeat/${a.stepId}`, {
      bearer: a.runnerToken,
      body: {},
    });
    expect({ status: response.status, local: snapshotTeam(world, a) }).toEqual({
      status: 410,
      local: prior,
    });
  });

  it('the other team remains intact when deleting an owned task', async () => {
    const { a, b, db } = world;
    const prior = snapshotTeam(world, b);
    expect((await asOwner(a, 'DELETE', `/api/todos/${a.todoId}`)).status).toBe(204);
    expect(db.select().from(build).where(eq(build.id, a.buildId)).get()).toBeUndefined();
    expect(snapshotTeam(world, b)).toEqual(prior);
  });
});

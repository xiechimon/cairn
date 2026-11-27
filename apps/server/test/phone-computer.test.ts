import { createHash } from 'node:crypto';
import {
  type ComputerCall,
  type MachineCapabilities,
  type MachineComputerRelayBody,
  type MachineStreamEvent,
  PHONE_AMBIGUOUS,
  PHONE_HANDED_BACK,
  PHONE_HANDOFF,
  PHONE_LOCKED,
  PHONE_MANAGE_PANEL_ONLY,
  PHONE_NOT_OWNER,
  PHONE_NOT_PAIRED,
  PHONE_UNREACHABLE,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  machine as machineTable,
  pairedDevice,
  phone as phoneTable,
  step as stepTable,
  user as userTable,
} from '../src/db/schema.js';
import { sweepComputerHandoffs } from '../src/services/computer-handoff.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  machinePhoneConsented,
  receiveComputerFrames,
} from '../src/services/machine-computer.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import {
  handbackPhone,
  listPhoneActivity,
  listPhones,
  offeredPhoneNames,
} from '../src/services/phone-computer.js';
import { bootServer, req, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const THREAD = 'chief-phone-thread';
const MAC: MachineCapabilities = {
  osPlatform: 'darwin',
  mcpServers: [],
  skills: [],
  phoneHost: true,
  phones: [
    { deviceId: 'android:aaaa1111bbbb2222', platform: 'android', name: 'Pixel 8a', link: 'ready' },
  ],
};

let server: TestServer | null = null;
afterEach(() => {
  dropComputerWaiters();
  server?.dispose();
  server = null;
});

interface World {
  s: TestServer;
  deps: MachineDeps;
  pushed: ComputerCall[];
}

function addThread(s: TestServer, id: string, userId: string) {
  const chiefId = `chief-${userId}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({ id: chiefId, userId, teamId: s.team.id, createdAt: 1 })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id,
      chiefId,
      userId,
      teamId: s.team.id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      sessionId: '',
      sessionOpenedAt: 1,
      archivedAt: 1,
    })
    .run();
}

function addStep(s: TestServer, id: string) {
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId: THREAD,
      kind: 'chief',
      machineId: 'sidecar',
      status: 'claimed',
      prompt: 'use the phone',
      ownerMessageIds: ['msg-1'],
      createdAt: 2,
    })
    .run();
}

function addHost(s: TestServer, id: string, capabilities: MachineCapabilities = MAC) {
  s.db
    .insert(machineTable)
    .values({ id, teamId: s.team.id, name: id, kind: 'local', online: true, capabilities })
    .run();
  const pushed: ComputerCall[] = [];
  s.machineHub.subscribeMachine(s.team.id, id, (ev: MachineStreamEvent) => {
    if (ev.type === 'computer') pushed.push(ev.call);
  });
  return pushed;
}

function addPhone(s: TestServer, opts: Partial<typeof phoneTable.$inferSelect> & { id: string }) {
  const now = Date.now();
  s.db
    .insert(phoneTable)
    .values({
      teamId: s.team.id,
      machineId: 'users-mac',
      platform: 'android',
      deviceId: 'android:aaaa1111bbbb2222',
      name: 'Pixel 8a',
      consentAt: now,
      consentedBy: s.user.id,
      createdAt: now,
      updatedAt: now,
      ...opts,
    })
    .run();
}

function world(capabilities: MachineCapabilities = MAC, authToken?: string): World {
  const s = bootServer(authToken === undefined ? {} : { authToken });
  server = s;
  s.db.insert(machineTable).values({ id: 'sidecar', teamId: s.team.id, name: 'sidecar' }).run();
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: 'sidecar' });
  addThread(s, THREAD, s.user.id);
  addStep(s, 'step-1');
  const pushed = addHost(s, 'users-mac', capabilities);
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps, pushed };
}

const call = (
  name: string,
  params: Record<string, unknown>,
  toolCallId = 'tc-1',
): MachineComputerRelayBody => ({
  computer: true as const,
  name: name as never,
  toolCallId,
  params,
});

function forward(w: World, body: MachineComputerRelayBody, stepId = 'step-1') {
  return forwardComputerCall(w.deps, 'sidecar', stepId, body);
}

async function until<T>(read: () => T | undefined | null | false): Promise<T> {
  for (let i = 0; i < 400; i += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never held');
}

describe('phone target resolution', () => {
  test('phone_observe stamps phoneId+deviceId and pushes to the phone host', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const pending = forward(w, call('phone_observe', { phone: 'Pixel 8a' }));
    const pushed = await until(() => w.pushed.at(-1));
    expect(pushed.tool).toBe('phone_observe');
    expect(pushed.phone).toEqual({ phoneId: 'ph1', deviceId: 'android:aaaa1111bbbb2222' });
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      { kind: 'done', seq: 1, text: '[1] Settings' },
    ]);
    const result = await pending;
    expect(result.text).toContain('Settings');
    const row = w.s.db
      .select()
      .from(computerCallTable)
      .where(eq(computerCallTable.id, pushed.callId))
      .get();
    expect(row?.phoneId).toBe('ph1');
    expect(row?.machineId).toBe('users-mac');
  });

  test('an endpoint-keyed row from the previous implementation is not operable', async () => {
    const w = world({
      ...MAC,
      phones: [
        {
          deviceId: '192.168.1.20:42155',
          platform: 'android',
          name: 'Pixel 8a',
          link: 'ready',
        },
      ],
    });
    addPhone(w.s, { id: 'ph-legacy', deviceId: '192.168.1.20:42155' });
    const result = await forward(w, call('phone_observe', { phone: 'Pixel 8a' }));
    expect(result.text).toBe(PHONE_NOT_PAIRED);
    expect(w.pushed).toEqual([]);
  });

  test('phone consent checks bind the phone, machine, device id and live consent row', () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    expect(
      machinePhoneConsented(w.s.db, w.s.team.id, 'users-mac', 'ph1', 'android:aaaa1111bbbb2222'),
    ).toBe(true);
    expect(
      machinePhoneConsented(w.s.db, w.s.team.id, 'users-mac', 'ph1', 'android:cccc3333dddd4444'),
    ).toBe(false);
    expect(
      machinePhoneConsented(w.s.db, w.s.team.id, 'sidecar', 'ph1', 'android:aaaa1111bbbb2222'),
    ).toBe(false);
    w.s.db.update(phoneTable).set({ consentAt: null }).where(eq(phoneTable.id, 'ph1')).run();
    expect(
      machinePhoneConsented(w.s.db, w.s.team.id, 'users-mac', 'ph1', 'android:aaaa1111bbbb2222'),
    ).toBe(false);
  });

  test('a call-scoped consent check refuses a cancelled computer call', () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const now = Date.now();
    w.s.db
      .insert(computerCallTable)
      .values({
        id: 'cc-phone-active',
        teamId: w.s.team.id,
        stepId: 'step-1',
        toolCallId: 'tc-phone-active',
        machineId: 'users-mac',
        phoneId: 'ph1',
        tool: 'phone_observe',
        replaySafe: true,
        params: {},
        state: 'running',
        deadlineAt: now + 60_000,
        createdAt: now,
      })
      .run();
    expect(
      machinePhoneConsented(
        w.s.db,
        w.s.team.id,
        'users-mac',
        'ph1',
        'android:aaaa1111bbbb2222',
        'cc-phone-active',
      ),
    ).toBe(true);
    w.s.db
      .update(computerCallTable)
      .set({ state: 'cancelled' })
      .where(eq(computerCallTable.id, 'cc-phone-active'))
      .run();
    expect(
      machinePhoneConsented(
        w.s.db,
        w.s.team.id,
        'users-mac',
        'ph1',
        'android:aaaa1111bbbb2222',
        'cc-phone-active',
      ),
    ).toBe(false);
  });

  test('a phone name that matches nothing is refused without dispatch', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const result = await forward(w, call('phone_observe', { phone: 'Other' }));
    expect(result.text).toBe(PHONE_NOT_PAIRED);
    expect(w.pushed).toEqual([]);
  });

  test('two consented phones with no name asked is ambiguous', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    addPhone(w.s, { id: 'ph2', deviceId: 'android:cccc3333dddd4444', name: 'Pixel 7' });
    const result = await forward(w, call('phone_observe', {}));
    expect(result.text).toBe(PHONE_AMBIGUOUS(['Pixel 8a', 'Pixel 7']));
    expect(w.pushed).toEqual([]);
  });

  test('a locked phone is handed back with a plain refusal', async () => {
    const w = world({
      ...MAC,
      phones: [
        {
          deviceId: 'android:aaaa1111bbbb2222',
          platform: 'android',
          name: 'Pixel 8a',
          link: 'locked',
        },
      ],
    });
    addPhone(w.s, { id: 'ph1' });
    const result = await forward(w, call('phone_observe', {}));
    expect(result.text).toBe(PHONE_LOCKED);
    expect(w.pushed).toEqual([]);
  });

  test('an unreachable phone refuses without dispatch', async () => {
    const w = world({
      ...MAC,
      phones: [
        {
          deviceId: 'android:aaaa1111bbbb2222',
          platform: 'android',
          name: 'Pixel 8a',
          link: 'offline',
        },
      ],
    });
    addPhone(w.s, { id: 'ph1' });
    const result = await forward(w, call('phone_observe', {}));
    expect(result.text).toBe(PHONE_UNREACHABLE);
    expect(w.pushed).toEqual([]);
  });

  test('phone_manage from the Coordinator is refused; only the panel can start it', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    await expect(forward(w, call('phone_manage', { action: 'forget' }))).rejects.toThrow(
      PHONE_MANAGE_PANEL_ONLY,
    );
    expect(w.pushed).toEqual([]);
  });

  test('a non-owner thread cannot use the phone', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const otherId = 'user-other';
    w.s.db.insert(userTable).values({ id: otherId, displayName: 'other' }).run();
    addThread(w.s, 'chief-other-thread', otherId);
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-x',
        buildId: 'chief-other-thread',
        kind: 'chief',
        machineId: 'sidecar',
        status: 'claimed',
        prompt: 'x',
        createdAt: 2,
      })
      .run();
    const result = await forward(w, call('phone_observe', {}), 'step-x');
    expect(result.text).toBe(PHONE_NOT_OWNER);
    expect(w.pushed).toEqual([]);
  });
});

describe('phone takeover and handback', () => {
  test('request_takeover holds the phone, blocks phone tools and releases on handback', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const pending = forward(
      w,
      call('request_takeover', { reason: 'unlock it', phone: 'Pixel 8a' }),
    );
    const held = await until(
      () =>
        w.s.db.select().from(phoneTable).where(eq(phoneTable.id, 'ph1')).get()?.handoffReason !=
        null,
    );
    expect(held).toBe(true);
    const refused = await forward(w, call('phone_observe', {}));
    expect(refused.text).toBe(PHONE_HANDOFF);
    expect(w.pushed).toEqual([]);
    handbackPhone(w.s.db, 'ph1');
    const result = await pending;
    expect(result.text).toBe(PHONE_HANDED_BACK);
  });

  test('a non-owner cannot take over the phone or wedge it', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const otherId = 'user-other';
    w.s.db.insert(userTable).values({ id: otherId, displayName: 'other' }).run();
    addThread(w.s, 'chief-other-thread', otherId);
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-x',
        buildId: 'chief-other-thread',
        kind: 'chief',
        machineId: 'sidecar',
        status: 'claimed',
        prompt: 'x',
        createdAt: 2,
      })
      .run();
    const result = await forward(
      w,
      call('request_takeover', { reason: 'unlock it', phone: 'Pixel 8a' }),
      'step-x',
    );
    expect(result.text).toBe(PHONE_NOT_OWNER);
    expect(
      w.s.db.select().from(phoneTable).where(eq(phoneTable.id, 'ph1')).get()?.handoffReason,
    ).toBeNull();
    expect(w.pushed).toEqual([]);
    const pending = forward(w, call('phone_observe', {}));
    const pushed = await until(() => w.pushed.at(-1));
    expect(pushed.tool).toBe('phone_observe');
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      { kind: 'done', seq: 1, text: '[1] Settings' },
    ]);
    const allowed = await pending;
    expect(allowed.text).toContain('Settings');
  });
});

describe('pair, forget and offer', () => {
  test('the pair route pushes phone_manage with the code and stamps the row', async () => {
    const w = world();
    const resP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      name: 'Pixel 8a',
      consent: true,
    });
    const pushed = await until(() => w.pushed.at(-1));
    expect(pushed.tool).toBe('phone_manage');
    expect(pushed.params).toEqual({
      action: 'pair',
      endpoint: '192.168.1.20:37001',
      code: '123456',
    });
    expect(pushed.phone?.deviceId).toBe('192.168.1.20:37001');
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      {
        kind: 'done',
        seq: 1,
        text: JSON.stringify({
          outcome: 'paired',
          deviceId: 'android:eeee5555ffff6666',
          name: 'Pixel 8a',
        }),
      },
    ]);
    const res = await resP;
    expect(res.status).toBe(201);
    const body = (await res.json()) as { phone: { deviceId: string; name: string } };
    expect(body.phone.deviceId).toBe('android:eeee5555ffff6666');
    const stored = w.s.db
      .select()
      .from(computerCallTable)
      .where(eq(computerCallTable.id, pushed.callId))
      .get();
    expect(stored?.params).not.toMatchObject({ code: '123456' });
  });

  test('public, tailnet and malformed pairing endpoints are rejected before dispatch', async () => {
    const w = world();
    for (const endpoint of ['8.8.8.8:37001', '100.64.1.2:37001', 'example.test:37001']) {
      const res = await req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
        endpoint,
        code: '123456',
        consent: true,
      });
      expect(res.status).toBe(400);
    }
    const withoutConsent = await req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      consent: false,
    });
    expect(withoutConsent.status).toBe(400);
    expect(w.pushed).toEqual([]);
    expect(w.s.db.select().from(phoneTable).all()).toEqual([]);
  });

  test('a concurrent pairing submission receives 409 instead of queueing behind the first', async () => {
    const w = world();
    const body = { endpoint: '192.168.1.20:37001', code: '123456', consent: true };
    const firstP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', body);
    const pushed = await until(() => w.pushed.at(-1));
    const secondP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      ...body,
      endpoint: '192.168.1.21:37001',
    });
    const second = await Promise.race([
      secondP,
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
    ]);
    expect(second).not.toBe('pending');
    if (second !== 'pending') expect(second.status).toBe(409);
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      {
        kind: 'done',
        seq: 1,
        text: JSON.stringify({
          outcome: 'paired',
          deviceId: 'android:eeee5555ffff6666',
          name: 'Pixel 8a',
        }),
      },
    ]);
    expect((await firstP).status).toBe(201);
    await secondP.catch(() => undefined);
  });

  test('forget while pairing settles the pending pairing request', async () => {
    const w = world();
    const pairP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      consent: true,
    });
    await until(() => w.pushed.at(-1));
    const row = w.s.db.select().from(phoneTable).where(eq(phoneTable.machineId, 'users-mac')).get();
    expect(row).toBeDefined();
    const removed = await req(w.s.app, 'DELETE', `/api/machines/users-mac/phones/${row!.id}`);
    expect(removed.status).toBe(200);
    const settled = await Promise.race([
      pairP.then((res) => res.status),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 200)),
    ]);
    expect(settled).toBe(409);
    await pairP.catch(() => undefined);
  });

  test('an expired pairing attempt is reaped into a bounded phone row error', async () => {
    const w = world();
    const resP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      consent: true,
    });
    const pushed = await until(() => w.pushed.at(-1));
    w.s.db
      .update(computerCallTable)
      .set({ deadlineAt: 1 })
      .where(eq(computerCallTable.id, pushed.callId))
      .run();
    sweepComputerHandoffs(w.s.db, 2);
    const res = await resP;
    expect(res.status).toBe(409);
    const row = w.s.db.select().from(phoneTable).where(eq(phoneTable.machineId, 'users-mac')).get();
    expect(row?.lastError).toBe('the server restarted before it finished');
    const callRow = w.s.db
      .select()
      .from(computerCallTable)
      .where(eq(computerCallTable.id, pushed.callId))
      .get();
    expect(callRow?.state).toBe('error');
    expect(() =>
      receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
        {
          kind: 'done',
          seq: 1,
          text: JSON.stringify({
            outcome: 'paired',
            deviceId: 'android:eeee5555ffff6666',
            name: 'Pixel 8a',
          }),
        },
      ]),
    ).toThrow(/already error/);
    const afterRow = w.s.db.select().from(phoneTable).where(eq(phoneTable.id, row!.id)).get();
    expect(afterRow?.deviceId).toBe('192.168.1.20:37001');
  });

  test('late pairing success frames after deadline expiration fail before reaper runs', async () => {
    const w = world();
    const resP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      consent: true,
    });
    const pushed = await until(() => w.pushed.at(-1));
    w.s.db
      .update(computerCallTable)
      .set({ deadlineAt: 1 })
      .where(eq(computerCallTable.id, pushed.callId))
      .run();
    expect(() =>
      receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
        {
          kind: 'done',
          seq: 1,
          text: JSON.stringify({
            outcome: 'paired',
            deviceId: 'android:eeee5555ffff6666',
            name: 'Pixel 8a',
          }),
        },
      ]),
    ).toThrow(/deadline expired/);
    const res = await resP;
    expect(res.status).toBe(409);
    const row = w.s.db.select().from(phoneTable).where(eq(phoneTable.machineId, 'users-mac')).get();
    expect(row?.deviceId).toBe('192.168.1.20:37001');
    expect(row?.lastError).toBe('the pairing deadline expired');
    const callRow = w.s.db
      .select()
      .from(computerCallTable)
      .where(eq(computerCallTable.id, pushed.callId))
      .get();
    expect(callRow?.state).toBe('error');
  });

  test('pairing an already-paired android id via POST merges into the existing phone row and preserves activity history', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph-existing', deviceId: 'android:eeee5555ffff6666', name: 'Old Pixel' });
    const now = Date.now();
    w.s.db
      .insert(computerCallTable)
      .values({
        id: 'cc-history-1',
        teamId: w.s.team.id,
        stepId: 'step-1',
        toolCallId: 'tc-history-1',
        machineId: 'users-mac',
        phoneId: 'ph-existing',
        tool: 'phone_observe',
        replaySafe: true,
        params: {},
        state: 'done',
        deadlineAt: now + 60_000,
        createdAt: now,
        finishedAt: now,
      })
      .run();
    const resP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      name: 'New Pixel Name',
      consent: true,
    });
    const pushed = await until(() => w.pushed.at(-1));
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      {
        kind: 'done',
        seq: 1,
        text: JSON.stringify({
          outcome: 'paired',
          deviceId: 'android:eeee5555ffff6666',
          name: 'Pixel 8a',
        }),
      },
    ]);
    const res = await resP;
    expect(res.status).toBe(201);
    const body = (await res.json()) as { phone: { id: string; deviceId: string; name: string } };
    expect(body.phone.id).toBe('ph-existing');
    expect(body.phone.deviceId).toBe('android:eeee5555ffff6666');
    expect(body.phone.name).toBe('Pixel 8a');
    const allRows = w.s.db
      .select()
      .from(phoneTable)
      .where(eq(phoneTable.machineId, 'users-mac'))
      .all();
    expect(allRows).toHaveLength(1);
    const calls = w.s.db
      .select()
      .from(computerCallTable)
      .where(eq(computerCallTable.phoneId, 'ph-existing'))
      .all();
    expect(calls.map((c) => c.id)).toContain('cc-history-1');
  });

  test('a wrong pairing code fails the call, keeps the row and stores lastError', async () => {
    const w = world();
    const resP = req(w.s.app, 'POST', '/api/machines/users-mac/phones', {
      endpoint: '192.168.1.20:37001',
      code: '000000',
      consent: true,
    });
    const pushed = await until(() => w.pushed.at(-1));
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      { kind: 'error', seq: 1, message: 'adb pair failed: wrong code', delivery: 'unknown' },
    ]);
    const res = await resP;
    expect(res.status).toBe(409);
    const row = w.s.db
      .select()
      .from(phoneTable)
      .where(and(eq(phoneTable.machineId, 'users-mac')))
      .get();
    expect(row).toBeDefined();
    expect(row?.lastError).toContain('wrong code');
  });

  test('a re-pair that lands on a different stable phone identity fails closed', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const resP = req(w.s.app, 'POST', '/api/machines/users-mac/phones/ph1/pair', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      consent: true,
    });
    const pushed = await until(() => w.pushed.at(-1));
    expect(pushed.tool).toBe('phone_manage');
    expect(pushed.phone?.deviceId).toBe('android:aaaa1111bbbb2222');
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      {
        kind: 'done',
        seq: 1,
        text: JSON.stringify({
          outcome: 'paired',
          deviceId: 'android:eeee5555ffff6666',
          name: 'Other Pixel',
        }),
      },
    ]);
    const res = await resP;
    expect(res.status).toBe(409);
    const row = w.s.db.select().from(phoneTable).where(eq(phoneTable.id, 'ph1')).get();
    expect(row?.deviceId).toBe('android:aaaa1111bbbb2222');
    expect(row?.name).toBe('Pixel 8a');
    expect(row?.lastError).toContain('identity changed');
  });

  test('re-pairing an endpoint-keyed row migrates the same phone id to the stable id', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph-legacy', deviceId: '192.168.1.20:42155', name: '旧手机' });
    const resP = req(w.s.app, 'POST', '/api/machines/users-mac/phones/ph-legacy/pair', {
      endpoint: '192.168.1.20:37001',
      code: '123456',
      consent: true,
    });
    const pushed = await until(() => w.pushed.at(-1));
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      {
        kind: 'done',
        seq: 1,
        text: JSON.stringify({
          outcome: 'paired',
          deviceId: 'android:eeee5555ffff6666',
          name: 'Pixel 8a',
        }),
      },
    ]);
    const res = await resP;
    expect(res.status).toBe(200);
    const row = w.s.db.select().from(phoneTable).where(eq(phoneTable.id, 'ph-legacy')).get();
    expect(row?.deviceId).toBe('android:eeee5555ffff6666');
    expect(row?.name).toBe('Pixel 8a');
  });

  test('a paired device can pair a phone like the owner session', async () => {
    const ownerToken = 'synthetic-owner-token';
    const deviceToken = 'cairn_dev_synthetic-device-token';
    const w = world(MAC, ownerToken);
    w.s.db
      .insert(pairedDevice)
      .values({
        id: 'pd',
        teamId: w.s.team.id,
        name: 'pd',
        tokenHash: createHash('sha256').update(deviceToken).digest('hex'),
        masked: 'x',
        createdAt: Date.now(),
      })
      .run();
    const body = { endpoint: '192.168.1.20:37001', code: '123456', consent: true };
    const allowed = w.s.app.request('/api/machines/users-mac/phones', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify(body),
    });
    const pushed = await until(() => w.pushed.at(-1));
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      {
        kind: 'done',
        seq: 1,
        text: JSON.stringify({
          outcome: 'paired',
          deviceId: 'android:aaaa1111bbbb2222',
          name: 'Pixel',
        }),
      },
    ]);
    expect((await allowed).status).toBe(201);
  });

  test('forget cancels active phone work without stopping the rest of the step', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const active = forward(w, call('phone_observe', { phone: 'Pixel 8a' }));
    const pushed = await until(() => w.pushed.at(-1));
    const stopEvents: string[] = [];
    const unsubscribe = w.s.machineHub.subscribe(w.s.team.id, (event) => {
      if (event.type === 'stop') stopEvents.push(event.stepId);
    });
    const res = await req(w.s.app, 'DELETE', '/api/machines/users-mac/phones/ph1');
    unsubscribe();
    expect(res.status).toBe(200);
    expect(stopEvents).toEqual([]);
    expect(
      w.s.db.select().from(computerCallTable).where(eq(computerCallTable.id, pushed.callId)).get()
        ?.state,
    ).toBe('cancelled');
    await active;
  });

  test('forget pushes phone_manage forget and removes the row', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const resP = req(w.s.app, 'DELETE', '/api/machines/users-mac/phones/ph1');
    const pushed = await until(() => w.pushed.at(-1));
    expect(pushed.tool).toBe('phone_manage');
    expect(pushed.params).toEqual({ action: 'forget' });
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      { kind: 'done', seq: 1, text: JSON.stringify({ outcome: 'forgotten' }) },
    ]);
    const res = await resP;
    expect(res.status).toBe(200);
    expect(w.s.db.select().from(phoneTable).where(eq(phoneTable.id, 'ph1')).get()).toBeUndefined();
  });

  test('late computer frames after phone removal fail with 409 and never recreate consent', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const pending = forward(w, call('phone_observe', { phone: 'Pixel 8a' }));
    const pushed = await until(() => w.pushed.at(-1));
    const res = await req(w.s.app, 'DELETE', '/api/machines/users-mac/phones/ph1');
    expect(res.status).toBe(200);
    await pending;
    expect(() =>
      receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
        { kind: 'done', seq: 1, text: '[1] Settings' },
      ]),
    ).toThrow(/already cancelled/);
    expect(w.s.db.select().from(phoneTable).where(eq(phoneTable.id, 'ph1')).get()).toBeUndefined();
  });

  test('offer gating lists only consented live phones on owner threads', async () => {
    const w = world();
    expect(offeredPhoneNames(w.deps, THREAD)).toEqual([]);
    addPhone(w.s, { id: 'ph1' });
    expect(offeredPhoneNames(w.deps, THREAD)).toEqual(['Pixel 8a']);
    const otherId = 'user-other-2';
    w.s.db.insert(userTable).values({ id: otherId, displayName: 'o2' }).run();
    addThread(w.s, 'chief-other-2', otherId);
    expect(offeredPhoneNames(w.deps, 'chief-other-2')).toEqual([]);
  });

  test('the phones list merges pairing/busy/handoff into the record', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const rows = listPhones(w.s.db, 'users-mac');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'ph1',
      name: 'Pixel 8a',
      consented: true,
      pairing: false,
      busy: false,
      handoff: false,
    });
  });

  test('phone calls land in the activity list with the phone name', async () => {
    const w = world();
    addPhone(w.s, { id: 'ph1' });
    const pending = forward(
      w,
      call('phone_act', { phone: 'Pixel 8a', actions: [{ kind: 'tap', x: 1, y: 2 }] }, 'tc-act'),
    );
    const pushed = await until(() => w.pushed.at(-1));
    receiveComputerFrames(w.s.db, w.s.hub, 'users-mac', pushed.callId, [
      { kind: 'done', seq: 1, text: 'tapped' },
    ]);
    await pending;
    const activity = listPhoneActivity(
      w.s.db,
      w.s.db.select().from(machineTable).where(eq(machineTable.id, 'users-mac')).get()!,
    );
    expect(activity.length).toBeGreaterThanOrEqual(1);
    expect(activity[0]).toMatchObject({ tool: 'phone_act', phoneName: 'Pixel 8a' });
    expect(activity[0]?.summary).toContain('tap');
  });
});

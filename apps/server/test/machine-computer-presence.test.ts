import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { computer, machine } from '../src/db/schema.js';
import { bootServer, issueApiKey } from './helpers.js';

type Server = ReturnType<typeof bootServer>;
let server: Server | undefined;
afterEach(() => server?.dispose());

async function post(s: Server, path: string, token: string, body: unknown) {
  return s.app.request(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function setup() {
  const s = bootServer();
  server = s;
  const enrolled = await post(s, '/api/machine/enroll', await issueApiKey(s), {
    teamId: s.team.id,
    name: 'computer-owner',
  });
  const { token, machineId } = (await enrolled.json()) as { token: string; machineId: string };
  const owner = s.db.select().from(machine).where(eq(machine.name, 'computer-owner')).get();
  if (!owner) throw new Error('owner missing');
  s.db.update(machine).set({ online: true }).where(eq(machine.id, owner.id)).run();
  s.db
    .insert(computer)
    .values({
      id: 'computer-one',
      teamId: s.team.id,
      machineId: owner.id,
      scopeKey: 'chief:one',
      providerRef: 'ref-one',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const events: object[] = [];
  s.hub.subscribe(s.team.id, {
    nextSeq: () => 1,
    send: async (event: object) => {
      events.push(event);
    },
  });
  const report = (state: string, extra: Record<string, unknown> = {}) => ({
    computers: [{ scopeKey: 'chief:one', providerRef: 'ref-one', state, ...extra }],
  });
  const read = () => s.db.select().from(computer).where(eq(computer.id, 'computer-one')).get();
  return { s, token, id: owner.id, machineId, report, read, events };
}

describe('computer observations in machine presence', () => {
  test('actual runtime transitions update state and notify an already-online panel', async () => {
    const f = await setup();
    for (const state of ['starting', 'running', 'stopped', 'failed']) {
      expect((await post(f.s, '/api/machine/presence', f.token, f.report(state))).status).toBe(200);
      expect(f.read()?.state).toBe(state);
    }
    expect(f.events).toEqual(
      Array.from({ length: 4 }, () => ({
        type: 'machine_presence',
        machineId: f.id,
        online: true,
      })),
    );
    expect(f.read()?.runningSince).toBeNull();
  });

  test('repeated running observations keep the start time and produce no duplicate event', async () => {
    const f = await setup();
    await post(f.s, '/api/machine/presence', f.token, f.report('running'));
    const first = f.read();
    expect(first?.runningSince).toBeTypeOf('number');
    await post(f.s, '/api/machine/presence', f.token, f.report('running'));
    expect(f.read()?.runningSince).toBe(first?.runningSince);
    expect(f.read()?.updatedAt).toBe(first?.updatedAt);
    expect(f.events).toHaveLength(1);
  });

  test('omitted and empty observations never imply stopped', async () => {
    const f = await setup();
    await post(f.s, '/api/machine/presence', f.token, f.report('running'));
    await post(f.s, '/api/machine/presence', f.token, {});
    await post(f.s, '/api/machine/presence', f.token, { computers: [] });
    expect(f.read()?.state).toBe('running');
    expect(f.events).toHaveLength(1);
  });

  test('foreign scopes, provider identities and machines cannot change or create a computer', async () => {
    const f = await setup();
    await post(
      f.s,
      '/api/machine/presence',
      f.token,
      f.report('running', { scopeKey: 'chief:foreign' }),
    );
    await post(
      f.s,
      '/api/machine/presence',
      f.token,
      f.report('running', { providerRef: 'ref-forged' }),
    );
    const other = await post(f.s, '/api/machine/enroll', await issueApiKey(f.s), {
      teamId: f.s.team.id,
      name: 'other',
    });
    const otherToken = ((await other.json()) as { token: string }).token;
    await post(f.s, '/api/machine/presence', otherToken, f.report('running'));
    expect(f.read()?.state).toBe('stopped');
    expect(f.s.db.select().from(computer).all()).toHaveLength(1);
  });

  test.each([
    { computers: [{ scopeKey: '', providerRef: 'ref-one', state: 'running' }] },
    { computers: [{ scopeKey: 'chief:one', providerRef: 'ref-one', state: 'invented' }] },
    {
      computers: Array.from({ length: 251 }, (_, n) => ({
        scopeKey: `chief:${n}`,
        providerRef: 'ref-one',
        state: 'running',
      })),
    },
    {
      computers: Array.from({ length: 2 }, () => ({
        scopeKey: 'chief:one',
        providerRef: 'ref-one',
        state: 'running',
      })),
    },
  ])('malformed or ambiguous reports are refused before state changes', async (body) => {
    const f = await setup();
    expect((await post(f.s, '/api/machine/presence', f.token, body)).status).toBe(400);
    expect(f.read()?.state).toBe('stopped');
    expect(f.events).toEqual([]);
  });
});

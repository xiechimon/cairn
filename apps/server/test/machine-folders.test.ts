import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { machine, pairedDevice } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import {
  applyFolderPinOps,
  applyFolderReport,
  folderPinsForPresence,
} from '../src/services/machine-folders.js';
import { bootServer } from './helpers.js';

type Server = ReturnType<typeof bootServer>;
let server: Server | undefined;
afterEach(() => server?.dispose());

function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (error) {
    return (error as { status?: number }).status ?? 0;
  }
  return 0;
}

describe('applyFolderPinOps', () => {
  test('pin stores a pending disabled pin and validates absolute traversal-free input', () => {
    const grants = applyFolderPinOps(null, [{ path: '/srv/data', op: 'pin' }]);
    expect(grants.pins).toEqual([{ path: '/srv/data', status: 'pending', enabled: false }]);
    for (const bad of ['etc/passwd', '/srv/../secret', '/', '~']) {
      expect(statusOf(() => applyFolderPinOps(null, [{ path: bad, op: 'pin' }]))).toBe(400);
    }
    expect(applyFolderPinOps(null, [{ path: '~/Code', op: 'pin' }]).pins[0]?.path).toBe('~/Code');
  });

  test('re-pin of a live pin is 409 while a rejected one returns to pending', () => {
    const previous = {
      bindsGrants: true as const,
      pins: [
        { path: '/a', status: 'pending' as const, enabled: false },
        { path: '/b', status: 'confirmed' as const, enabled: true },
        { path: '/c', status: 'rejected' as const, enabled: false },
      ],
    };
    for (const path of ['/a', '/b']) {
      expect(statusOf(() => applyFolderPinOps(previous, [{ path, op: 'pin' }]))).toBe(409);
    }
    const grants = applyFolderPinOps(previous, [{ path: '/c', op: 'pin' }]);
    expect(grants.pins.find((p) => p.path === '/c')?.status).toBe('pending');
  });

  test('pinning the workspaces dir is 409 and enable requires confirmed plus bindsGrants', () => {
    const base = {
      workspacesDir: '/srv/workspaces',
      pins: [
        { path: '/pending', status: 'pending' as const, enabled: false },
        { path: '/confirmed', status: 'confirmed' as const, enabled: false },
      ],
    };
    expect(statusOf(() => applyFolderPinOps(base, [{ path: '/srv/workspaces', op: 'pin' }]))).toBe(
      409,
    );
    for (const path of ['/pending', '/confirmed']) {
      expect(statusOf(() => applyFolderPinOps(base, [{ path, op: 'enable' }]))).toBe(409);
    }
    const bound = applyFolderPinOps({ ...base, bindsGrants: true }, [
      { path: '/confirmed', op: 'enable' },
    ]);
    expect(bound.pins.find((p) => p.path === '/confirmed')?.enabled).toBe(true);
    expect(bound.pins.find((p) => p.path === '/pending')?.enabled).toBe(false);
  });

  test('disable and remove adjust the pin; unknown paths are 404', () => {
    const previous = {
      bindsGrants: true as const,
      pins: [{ path: '/a', status: 'confirmed' as const, enabled: true }],
    };
    expect(applyFolderPinOps(previous, [{ path: '/a', op: 'disable' }]).pins[0]?.enabled).toBe(
      false,
    );
    expect(applyFolderPinOps(previous, [{ path: '/a', op: 'remove' }]).pins).toEqual([]);
    for (const op of ['enable', 'disable', 'remove'] as const) {
      expect(statusOf(() => applyFolderPinOps(previous, [{ path: '/missing', op }]))).toBe(404);
    }
  });
});

describe('applyFolderReport', () => {
  const previous = {
    workspacesDir: '/srv/workspaces',
    pins: [
      { path: '/pending', status: 'pending' as const, enabled: false },
      { path: '/gone', status: 'confirmed' as const, enabled: true },
      { path: '/bad', status: 'pending' as const, enabled: false },
    ],
  };

  test('confirmed reports store the canonical path; failures disable the pin', () => {
    const grants = applyFolderReport(previous, {
      workspacesDir: '/srv/workspaces',
      bindsGrants: true,
      pins: [
        { pin: '/pending', status: 'confirmed', canonicalPath: '/real/pending' },
        { pin: '/gone', status: 'absent' },
        { pin: '/bad', status: 'rejected' },
      ],
    });
    expect(grants.bindsGrants).toBe(true);
    expect(grants.pins).toEqual([
      { path: '/real/pending', status: 'confirmed', enabled: false },
      { path: '/gone', status: 'absent', enabled: false },
      { path: '/bad', status: 'rejected', enabled: false },
    ]);
  });

  test('a canonical path colliding with another root is rejected and disabled', () => {
    const grants = applyFolderReport(previous, {
      workspacesDir: '/srv/workspaces',
      pins: [{ pin: '/pending', status: 'confirmed', canonicalPath: '/srv/workspaces' }],
    });
    expect(grants.pins.find((p) => p.path === '/pending')?.status).toBe('rejected');
  });

  test('non-absolute or traversal canonical reports are ignored', () => {
    const grants = applyFolderReport(previous, {
      pins: [
        { pin: '/pending', status: 'confirmed', canonicalPath: 'relative/dir' },
        { pin: '/bad', status: 'confirmed', canonicalPath: '/srv/../etc' },
      ],
    });
    expect(grants.pins.find((p) => p.path === '/pending')?.status).toBe('pending');
    expect(grants.pins.find((p) => p.path === '/bad')?.status).toBe('pending');
  });
});

describe('folderPinsForPresence', () => {
  test('only pending and confirmed pins go back to the daemon', () => {
    expect(
      folderPinsForPresence({
        pins: [
          { path: '/a', status: 'pending', enabled: false },
          { path: '/b', status: 'confirmed', enabled: true },
          { path: '/c', status: 'rejected', enabled: false },
          { path: '/d', status: 'absent', enabled: false },
        ],
      }),
    ).toEqual([
      { path: '/a', status: 'pending', enabled: false },
      { path: '/b', status: 'confirmed', enabled: true },
    ]);
    expect(folderPinsForPresence(null)).toBeUndefined();
    expect(folderPinsForPresence({ pins: [] })).toBeUndefined();
  });
});

describe('folder grants over the routes', () => {
  async function boot() {
    const s = bootServer({ authToken: 'folder-route-test' });
    server = s;
    s.db
      .insert(pairedDevice)
      .values({
        id: 'paired',
        teamId: s.team.id,
        name: 'test',
        tokenHash: 'synthetic',
        masked: 'test',
        createdAt: 1,
      })
      .run();
    s.db.insert(machine).values({ id: 'folder-machine', name: 'orb', teamId: s.team.id }).run();
    return s;
  }

  function patch(
    s: Server,
    machineId: string,
    body: unknown,
    kind: 'owner' | 'device' | 'agent' = 'owner',
  ) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    };
    if (kind === 'agent')
      headers.authorization = `Bearer ${createApiKey(s, { teamId: s.team.id, gitAccess: false, mcpAccess: true, machineAccess: true, toolGrants: { read: [], write: [] } }).plaintext}`;
    else
      headers.cookie = `cairn_auth=${issueBrowserSession(s.db, kind, kind === 'device' ? 'paired' : null).token}`;
    return s.app.request(`/api/machines/${machineId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
  }

  async function post(s: Server, path: string, token: string, body: unknown) {
    return s.app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('owner pins reach the daemon in presence and the daemon report confirms them', async () => {
    const s = await boot();
    const pin = await patch(s, 'folder-machine', {
      folderPins: [{ path: '/srv/data', op: 'pin' }],
    });
    expect(pin.status).toBe(200);
    const stored = () =>
      s.db.select().from(machine).where(eq(machine.id, 'folder-machine')).get()?.folderGrants;
    expect(stored()?.pins).toEqual([{ path: '/srv/data', status: 'pending', enabled: false }]);

    const enrolled = await post(
      s,
      '/api/machine/enroll',
      createApiKey(s, {
        teamId: s.team.id,
        gitAccess: false,
        mcpAccess: false,
        machineAccess: true,
        toolGrants: { read: [], write: [] },
      }).plaintext,
      {
        teamId: s.team.id,
        name: 'folder-runner',
      },
    );
    const { token, machineId } = (await enrolled.json()) as { token: string; machineId: string };
    const pinRunner = await patch(s, machineId, {
      folderPins: [{ path: '/srv/other', op: 'pin' }],
    });
    expect(pinRunner.status).toBe(200);
    const presence = await post(s, '/api/machine/presence', token, {
      folders: { workspacesDir: '/srv/workspaces' },
    });
    const body = (await presence.json()) as {
      folderPins?: { path: string; status: string; enabled: boolean }[];
    };
    expect(body.folderPins).toEqual([{ path: '/srv/other', status: 'pending', enabled: false }]);

    const row = () =>
      s.db.select().from(machine).where(eq(machine.id, machineId)).get()?.folderGrants;
    const confirm = await post(s, '/api/machine/presence', token, {
      folders: {
        workspacesDir: '/srv/workspaces',
        pins: [{ pin: '/srv/other', status: 'confirmed', canonicalPath: '/srv/other' }],
      },
    });
    expect(confirm.status).toBe(200);
    expect(row()?.pins).toEqual([{ path: '/srv/other', status: 'confirmed', enabled: false }]);
    expect(row()?.workspacesDir).toBe('/srv/workspaces');
    const after = (await (await post(s, '/api/machine/presence', token, {})).json()) as {
      folderPins?: { path: string }[];
    };
    expect(after.folderPins?.map((p) => p.path)).toEqual(['/srv/other']);
    expect(stored()?.pins).toEqual([{ path: '/srv/data', status: 'pending', enabled: false }]);
  });

  test('enable of a confirmed pin is 409 until the daemon reports bindsGrants', async () => {
    const s = await boot();
    s.db
      .update(machine)
      .set({
        folderGrants: {
          workspacesDir: '/srv/workspaces',
          pins: [{ path: '/srv/data', status: 'confirmed', enabled: false }],
        },
      })
      .where(eq(machine.id, 'folder-machine'))
      .run();
    const denied = await patch(s, 'folder-machine', {
      folderPins: [{ path: '/srv/data', op: 'enable' }],
    });
    expect(denied.status).toBe(409);
    s.db
      .update(machine)
      .set({
        folderGrants: {
          workspacesDir: '/srv/workspaces',
          bindsGrants: true,
          pins: [{ path: '/srv/data', status: 'confirmed', enabled: false }],
        },
      })
      .where(eq(machine.id, 'folder-machine'))
      .run();
    const allowed = await patch(s, 'folder-machine', {
      folderPins: [{ path: '/srv/data', op: 'enable' }],
    });
    expect(allowed.status).toBe(200);
    const record = (await allowed.json()) as { folderGrants?: { pins: { enabled: boolean }[] } };
    expect(record.folderGrants?.pins[0]?.enabled).toBe(true);
  });

  test.each(['device', 'agent'] as const)('%s cannot touch folder grants', async (kind) => {
    const s = await boot();
    const res = await patch(
      s,
      'folder-machine',
      {
        folderPins: [{ path: '/srv/data', op: 'pin' }],
      },
      kind,
    );
    expect(res.status).toBe(kind === 'device' ? 403 : 401);
    expect(
      s.db.select().from(machine).where(eq(machine.id, 'folder-machine')).get()?.folderGrants,
    ).toBeNull();
  });
});

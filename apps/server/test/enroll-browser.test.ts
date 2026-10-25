import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { bootServer, req } from './helpers.js';

describe('browser authorization flow (W4 #285)', () => {
  test('start -> poll pending -> confirm -> authorized; unknown/double/invalid gates', async () => {
    const s = bootServer();
    const started = await req(s.app, 'POST', '/api/machine/enroll/start', {
      name: 'mbp-14',
    });
    expect(started.status).toBe(200);
    const startBody = (await started.json()) as { enrollId: string; url: string };
    expect(startBody.url).toContain(`/app/machines/authorize?enroll=${startBody.enrollId}`);

    const pending = await req(s.app, 'POST', '/api/machine/enroll/poll', {
      enrollId: startBody.enrollId,
    });
    expect(await pending.json()).toEqual({ status: 'pending' });
    const unknown = await req(s.app, 'POST', '/api/machine/enroll/poll', {
      enrollId: 'nope',
    });
    expect(await unknown.json()).toEqual({ status: 'expired' });

    const bad = await req(s.app, 'POST', '/api/machine/enroll/confirm', { enrollId: 'nope' });
    expect(bad.status).toBe(404);
    expect(Object.keys((await bad.json()) as object)).toEqual(['error']);

    const confirmed = await req(s.app, 'POST', '/api/machine/enroll/confirm', {
      enrollId: startBody.enrollId,
    });
    expect(confirmed.status).toBe(200);
    const { machine } = (await confirmed.json()) as {
      machine: { machineId: string; token: string; teamId: string; serverUrl: string };
    };
    expect(machine.teamId).toBe(s.team.id);
    expect(machine.serverUrl).toContain('http');
    const row = s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, machine.machineId))
      .get();
    expect(row).toMatchObject({
      teamId: s.team.id,
      name: 'mbp-14',
      apiKeyId: null,
      online: false,
    });
    expect(row?.tokenHash).toBeTruthy();

    const after = await req(s.app, 'POST', '/api/machine/enroll/poll', {
      enrollId: startBody.enrollId,
    });
    expect(await after.json()).toEqual({ status: 'authorized', machine });

    const again = await req(s.app, 'POST', '/api/machine/enroll/confirm', {
      enrollId: startBody.enrollId,
    });
    expect(again.status).toBe(409);
  });
});

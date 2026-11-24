import type { MachineStreamEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { markPresence } from '../src/services/machines.js';
import { bootServer, insertMachine, redeemTestPairing, req } from './helpers.js';

describe('managed runtime updates (server)', () => {
  test('POST /api/teams/:id/providers/runtimes/:runtime/update pushes runtime.update to online machines', async () => {
    const s = bootServer();
    const m1 = insertMachine(s, { name: 'mbp-1' });
    const events: MachineStreamEvent[] = [];
    const unsubscribe = s.machineHub.subscribeMachine(s.team.id, m1, (ev) => events.push(ev));
    try {
      const res = await req(
        s.app,
        'POST',
        `/api/teams/${s.team.id}/providers/runtimes/claude-code/update`,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, machines: [m1] });
      expect(events).toContainEqual({ type: 'runtime.update', runtime: 'claude-code' });
    } finally {
      unsubscribe();
    }
  });

  test('refuses non-owner paired device with 403', async () => {
    const owner = 'owner-secret';
    const s = bootServer({ authToken: owner });
    const issued = await s.app.request('/api/remote/pairing', {
      method: 'POST',
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(issued.status).toBe(201);
    const { code } = (await issued.json()) as { code: string };
    const paired = await redeemTestPairing(s.app, code, 'Paired phone');
    expect(paired.status).toBe(201);
    const { token } = (await paired.json()) as { token: string };
    const m1 = insertMachine(s, { name: 'mbp-1' });
    const unsubscribe = s.machineHub.subscribeMachine(s.team.id, m1, () => {});
    try {
      const res = await s.app.request(
        `/api/teams/${s.team.id}/providers/runtimes/claude-code/update`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        },
      );
      expect(res.status).toBe(403);
    } finally {
      unsubscribe();
    }
  });

  test('rejects unknown runtime with 404 and offline machines with 409', async () => {
    const s = bootServer();
    const unknown = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/providers/runtimes/antigravity/update`,
    );
    expect(unknown.status).toBe(404);

    const offline = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/providers/runtimes/devin/update`,
    );
    expect(offline.status).toBe(409);
  });

  test('model-sources surfaces version and runtimeUpdate and markPresence notifies team stream on change', async () => {
    const s = bootServer();
    const m1 = insertMachine(s, { name: 'mbp-1' });
    const teamEvents: object[] = [];
    let seq = 0;
    const unsub = s.hub.subscribe(s.team.id, {
      nextSeq: () => ++seq,
      send: async (ev) => {
        teamEvents.push(ev);
      },
    });
    try {
      markPresence(
        {
          db: s.db,
          box: s.secretBox,
          hub: s.hub,
          machineHub: s.machineHub,
          user: s.user,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir: s.skillsDir,
        },
        m1,
        {
          claudeCode: {
            installed: true,
            hostname: 'mbp-1',
            models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }],
            bin: { path: '/tools/claude/2.1.330/claude', version: '2.1.330' },
            update: {
              installedVersion: '2.1.330',
              availableVersion: '2.1.331',
              phase: 'idle',
            },
          },
          capabilities: {
            mcpServers: [],
            skills: [],
            devin: {
              installed: true,
              version: '3000.0.1',
              update: {
                installedVersion: '3000.0.1',
                availableVersion: '3000.0.2',
                phase: 'idle',
              },
            },
            gemini: {
              installed: true,
              version: '0.70.0',
              update: {
                installedVersion: '0.70.0',
                availableVersion: '0.71.0',
                phase: 'updating',
              },
            },
          },
        },
        true,
      );

      expect(teamEvents.some((ev) => (ev as { type?: string }).type === 'machine_presence')).toBe(
        true,
      );

      const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/model-sources`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sources: {
          runtime: string;
          version?: string | null;
          runtimeUpdate?: { availableVersion?: string | null; phase?: string };
        }[];
      };
      expect(body.sources.find((src) => src.runtime === 'claude-code')).toMatchObject({
        version: '2.1.330',
        runtimeUpdate: { installedVersion: '2.1.330', availableVersion: '2.1.331', phase: 'idle' },
      });
      expect(body.sources.find((src) => src.runtime === 'devin')).toMatchObject({
        version: '3000.0.1',
        runtimeUpdate: {
          installedVersion: '3000.0.1',
          availableVersion: '3000.0.2',
          phase: 'idle',
        },
      });
      expect(body.sources.find((src) => src.runtime === 'gemini')).toMatchObject({
        version: '0.70.0',
        runtimeUpdate: {
          installedVersion: '0.70.0',
          availableVersion: '0.71.0',
          phase: 'updating',
        },
      });
    } finally {
      unsub();
    }
  });
});

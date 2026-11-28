import type { ChiefGetResponse } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chief as chiefTable,
  chiefThread,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { setCoordinatorWake } from '../src/services/coordinator-context.js';
import { createProvider } from '../src/services/providers.js';
import { writeQuota } from '../src/services/step-groups/quota.js';
import {
  bootServer,
  insertMachine,
  openStream,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';
import { insertStepFixture, readStepFixture } from './step-groups-fixture.js';

function seedProvider(s: TestServer, providerId: string, modelId: string): void {
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId,
        label: providerId,
        baseUrl: `https://${providerId}.example.com/v1`,
        api: 'openai-completions',
        apiKey: `${providerId}-key`,
        models: [{ id: modelId, name: modelId }],
      },
      createdBy: s.user.id,
    },
  );
}

function seedChiefWithThread(
  s: TestServer,
  opts: { id: string; projectId?: string | null },
): string {
  const now = nowMs();
  const chiefId = `chief-${s.user.id}-${s.team.id}`;
  const existing = s.db.select().from(chiefTable).where(eq(chiefTable.id, chiefId)).get();
  if (existing === undefined) {
    s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        watches: [],
        wakes: [],
        lastTurnAt: null,
        createdAt: now,
        tz: 'UTC',
      })
      .run();
  }
  s.db
    .insert(chiefThread)
    .values({
      id: opts.id,
      chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      projectId: opts.projectId ?? null,
      title: 'Coordinator',
      createdAt: now,
      updatedAt: now,
      lastTurnAt: null,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: { phase: 'chief' },
    })
    .run();
  return opts.id;
}

describe('switching Coordinator model clears parked quota outage and wakes Coordinator', () => {
  afterEach(() => {
    setCoordinatorWake(() => {});
  });

  test('PATCH /api/teams/:id/routing-rules/coordinator releases parked chief steps, clears outage, wakes Coordinator/machines, and publishes chief SSE', async () => {
    const s = bootServer();
    const machineId = insertMachine(s);
    seedProvider(s, 'antigravity-proxy', 'gemini-4-hydrogen');
    seedRoute(s, 'coordinator', { provider: 'devin', modelId: 'swe-2-1-medium' });

    const mainThread = seedChiefWithThread(s, { id: 'chief-main' });
    const plainProjectId = await postProject(s.app, 'Plain');
    const heldThread = seedChiefWithThread(s, { id: 'chief-held', projectId: plainProjectId });
    const overriddenProjectId = await postProject(s.app, 'Overridden');
    s.db
      .update(projectTable)
      .set({
        modelOverrides: {
          coordinator: { provider: 'devin', modelId: 'swe-2-1-medium', thinkingLevel: null },
        },
      })
      .where(eq(projectTable.id, overriddenProjectId))
      .run();
    const overriddenThread = seedChiefWithThread(s, {
      id: 'chief-overridden',
      projectId: overriddenProjectId,
    });

    const now = nowMs();
    insertStepFixture(s.db, {
      id: 'step-waiting-quota',
      buildId: mainThread,
      kind: 'chief',
      machineId,
      status: 'waiting_quota',
      holdReason: null,
      holdUntil: null,
      holdCount: 2,
      quotaBlock: {
        kind: 'capacity',
        providerId: 'devin',
        label: 'Devin',
        reason: 'overloaded',
        retryAfterMs: 60_000,
        firstSeenAt: now - 10_000,
        lastAt: now,
        attempts: 2,
        probeAt: now + 60_000,
      },
      ranModel: { provider: 'devin', modelId: 'swe-2-1-medium' },
      fallback: {
        model: { provider: 'devin', modelId: 'swe-2-1-medium' },
        tried: ['devin/swe-2-1-medium'],
        zeroUsageRetried: false,
      },
      routedReason: 'busy',
      prompt: 'hello',
      createdAt: now,
    });
    insertStepFixture(s.db, {
      id: 'step-hold-quota',
      buildId: heldThread,
      kind: 'chief',
      machineId,
      status: 'pending',
      holdReason: 'quota',
      holdUntil: now + 120_000,
      holdCount: 3,
      ranModel: { provider: 'devin', modelId: 'swe-2-1-medium' },
      fallback: {
        model: { provider: 'devin', modelId: 'swe-2-1-medium' },
        tried: ['devin/swe-2-1-medium'],
        zeroUsageRetried: false,
      },
      routedReason: 'offline',
      prompt: 'hello 2',
      createdAt: now - 1_000,
    });
    insertStepFixture(s.db, {
      id: 'step-overridden-project',
      buildId: overriddenThread,
      kind: 'chief',
      machineId,
      status: 'waiting_quota',
      quotaBlock: {
        kind: 'quota',
        providerId: 'devin',
        label: 'Devin',
        reason: 'overloaded',
        retryAfterMs: 60_000,
        firstSeenAt: now - 10_000,
        lastAt: now,
        attempts: 1,
        probeAt: now + 60_000,
      },
      ranModel: { provider: 'devin', modelId: 'swe-2-1-medium' },
      prompt: 'project hello',
      createdAt: now - 2_000,
    });

    const beforeRes = await req(s.app, 'GET', `/api/teams/${s.team.id}/chief`);
    expect(beforeRes.status).toBe(200);
    const beforeChief = (await beforeRes.json()) as ChiefGetResponse;
    expect(beforeChief.outage).toMatchObject({
      reason: 'capacity',
      model: 'devin/swe-2-1-medium',
    });

    const wokenThreads: string[] = [];
    setCoordinatorWake((threadId) => wokenThreads.push(threadId));
    const wakeBefore = s.machineHub.wakeSeq(s.team.id);
    const stream = await openStream(s.app, s.team.id);
    try {
      const sameModelPatch = await req(
        s.app,
        'PATCH',
        `/api/teams/${s.team.id}/routing-rules/coordinator`,
        { thinkingLevel: 'high' },
      );
      expect(sameModelPatch.status).toBe(200);
      expect(
        s.db.select().from(stepTable).where(eq(stepTable.id, 'step-waiting-quota')).get()?.status,
      ).toBe('waiting_quota');

      const switchRes = await req(
        s.app,
        'PATCH',
        `/api/teams/${s.team.id}/routing-rules/coordinator`,
        { provider: 'antigravity-proxy', modelId: 'gemini-4-hydrogen' },
      );
      expect(switchRes.status).toBe(200);

      const releasedMain = readStepFixture(s.db, 'step-waiting-quota');
      expect(releasedMain).toMatchObject({
        status: 'pending',
        holdReason: null,
        holdUntil: null,
        holdCount: 0,
        quotaBlock: null,
        ranModel: null,
        fallback: null,
        machineId: null,
        routedReason: null,
      });

      const releasedHeld = readStepFixture(s.db, 'step-hold-quota');
      expect(releasedHeld).toMatchObject({
        status: 'pending',
        holdReason: null,
        holdUntil: null,
        holdCount: 0,
        quotaBlock: null,
        ranModel: null,
        fallback: null,
        machineId: null,
        routedReason: null,
      });

      const untouchedOverridden = s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.id, 'step-overridden-project'))
        .get();
      expect(untouchedOverridden?.status).toBe('waiting_quota');

      expect(wokenThreads).toContain(mainThread);
      expect(wokenThreads).toContain(heldThread);
      expect(s.machineHub.wakeSeq(s.team.id)).toBeGreaterThan(wakeBefore);

      const sseEvent = await stream.next((ev) => ev.type === 'chief.updated');
      expect(sseEvent).toEqual({ type: 'chief.updated' });

      s.db.delete(stepTable).where(eq(stepTable.id, 'step-overridden-project')).run();
      const afterRes = await req(s.app, 'GET', `/api/teams/${s.team.id}/chief`);
      expect(afterRes.status).toBe(200);
      const afterChief = (await afterRes.json()) as ChiefGetResponse;
      expect(afterChief.outage).toBeNull();
    } finally {
      stream.close();
    }
  });

  test('PATCH /api/projects/:id modelOverrides.coordinator releases parked steps for that project only', async () => {
    const s = bootServer();
    const machineId = insertMachine(s);
    seedProvider(s, 'antigravity-proxy', 'gemini-4-hydrogen');
    seedRoute(s, 'coordinator', { provider: 'devin', modelId: 'swe-2-1-medium' });

    const projA = await postProject(s.app, 'Project A');
    const projB = await postProject(s.app, 'Project B');
    const threadA = seedChiefWithThread(s, { id: 'chief-proj-a', projectId: projA });
    const threadB = seedChiefWithThread(s, { id: 'chief-proj-b', projectId: projB });

    const now = nowMs();
    insertStepFixture(s.db, {
      id: 'step-a',
      buildId: threadA,
      kind: 'chief',
      machineId,
      status: 'waiting_quota',
      quotaBlock: {
        kind: 'capacity',
        providerId: 'devin',
        label: 'Devin',
        reason: 'overloaded',
        retryAfterMs: 60_000,
        firstSeenAt: now - 5_000,
        lastAt: now,
        attempts: 1,
        probeAt: now + 60_000,
      },
      ranModel: { provider: 'devin', modelId: 'swe-2-1-medium' },
      prompt: 'project a',
      createdAt: now,
    });
    insertStepFixture(s.db, {
      id: 'step-b',
      buildId: threadB,
      kind: 'chief',
      machineId,
      status: 'waiting_quota',
      quotaBlock: {
        kind: 'capacity',
        providerId: 'devin',
        label: 'Devin',
        reason: 'overloaded',
        retryAfterMs: 60_000,
        firstSeenAt: now - 5_000,
        lastAt: now,
        attempts: 1,
        probeAt: now + 60_000,
      },
      ranModel: { provider: 'devin', modelId: 'swe-2-1-medium' },
      prompt: 'project b',
      createdAt: now - 1_000,
    });

    const beforeRes = await req(s.app, 'GET', `/api/teams/${s.team.id}/chief`);
    expect(((await beforeRes.json()) as ChiefGetResponse).outage).toMatchObject({
      reason: 'capacity',
      model: 'devin/swe-2-1-medium',
    });

    const wokenThreads: string[] = [];
    setCoordinatorWake((threadId) => wokenThreads.push(threadId));
    const wakeBefore = s.machineHub.wakeSeq(s.team.id);
    const stream = await openStream(s.app, s.team.id);
    try {
      const patchRes = await req(s.app, 'PATCH', `/api/projects/${projA}`, {
        modelOverrides: {
          coordinator: {
            provider: 'antigravity-proxy',
            modelId: 'gemini-4-hydrogen',
            thinkingLevel: null,
          },
        },
      });
      expect(patchRes.status).toBe(200);

      const stepA = readStepFixture(s.db, 'step-a');
      expect(stepA).toMatchObject({
        status: 'pending',
        holdReason: null,
        holdUntil: null,
        quotaBlock: null,
        ranModel: null,
        fallback: null,
        machineId: null,
        routedReason: null,
      });

      const stepB = s.db.select().from(stepTable).where(eq(stepTable.id, 'step-b')).get();
      expect(stepB?.status).toBe('waiting_quota');

      expect(wokenThreads).toContain(threadA);
      expect(wokenThreads).not.toContain(threadB);
      expect(s.machineHub.wakeSeq(s.team.id)).toBeGreaterThan(wakeBefore);
      expect(await stream.next((ev) => ev.type === 'chief.updated')).toEqual({
        type: 'chief.updated',
      });

      s.db.delete(stepTable).where(eq(stepTable.id, 'step-b')).run();
      const afterRes = await req(s.app, 'GET', `/api/teams/${s.team.id}/chief`);
      expect(((await afterRes.json()) as ChiefGetResponse).outage).toBeNull();

      s.db
        .update(stepTable)
        .set({
          status: 'waiting_quota',
          holdReason: null,
        })
        .where(eq(stepTable.id, 'step-a'))
        .run();
      s.db.transaction((tx) =>
        writeQuota(tx, 'step-a', {
          ranModel: { provider: 'antigravity-proxy', modelId: 'gemini-4-hydrogen' },
          quotaBlock: {
            kind: 'quota',
            providerId: 'antigravity-proxy',
            label: 'Antigravity',
            reason: 'overloaded',
            retryAfterMs: 60_000,
            firstSeenAt: now,
            lastAt: now,
            attempts: 1,
            probeAt: now + 60_000,
          },
        }),
      );
      const clearOverrideRes = await req(s.app, 'PATCH', `/api/projects/${projA}`, {
        modelOverrides: { coordinator: null },
      });
      expect(clearOverrideRes.status).toBe(200);
      expect(s.db.select().from(stepTable).where(eq(stepTable.id, 'step-a')).get()?.status).toBe(
        'pending',
      );
      expect(await stream.next((ev) => ev.type === 'chief.updated')).toEqual({
        type: 'chief.updated',
      });
    } finally {
      stream.close();
    }
  });
});

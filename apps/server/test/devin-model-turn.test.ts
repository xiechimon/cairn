import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { sha256Hex } from '../src/lib/crypto.js';
import type { MachineStreamEvent } from '@cairn/shared';
import {
  bootServer,
  insertDevinSubscription,
  insertMachine,
  req,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let runnerSeq = 0;

function attachRunner(
  s: TestServer,
  capabilities: Parameters<typeof insertMachine>[1]['capabilities'],
  events: string[],
  onEvent?: (event: MachineStreamEvent) => void,
): { id: string; token: string; connectionId: string } {
  runnerSeq += 1;
  const id = insertMachine(s, { name: `devin-turn-${runnerSeq}`, capabilities });
  const token = `devin-turn-token-${Math.random().toString(36).slice(2)}`;
  s.db
    .update(machineTable)
    .set({ tokenHash: sha256Hex(token) })
    .where(eq(machineTable.id, id))
    .run();
  const close = s.machineHub.subscribeMachine(s.team.id, id, (event) => {
    events.push(event.type);
    onEvent?.(event);
  });
  disposables.push(close);
  const connectionId = s.machineHub.connectionId(id);
  if (connectionId === undefined) throw new Error('runner did not connect');
  return { id, token, connectionId };
}

const RUNNER_ONLINE = {
  mcpServers: [],
  skills: [],
  modelTurnProbe: true as const,
  devin: { installed: true, authenticated: true, models: [] },
};

describe('Devin subscription model tests', () => {
  test('reports an unavailable Runner instead of passing from the saved catalog', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const id = insertDevinSubscription(s);
    const path = `/api/teams/${s.team.id}/devin-subscriptions/${id}/test`;
    const result = await req(s.app, 'POST', path, { model: 'swe-2-1' });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: 'failed',
      reason: 'runner-unavailable',
      detail: null,
      latencyMs: null,
    });
  });

  test('runs the family at its chosen effort and only on an eligible Runner', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const ineligibleEvents: string[] = [];
    const ineligible = attachRunner(s, { mcpServers: [], skills: [] }, ineligibleEvents);
    const events: string[] = [];
    const sent = deferred<string>();
    const runner = attachRunner(s, RUNNER_ONLINE, events, (event) => {
      if (event.type === 'provider.model-test') sent.resolve(event.requestId);
    });
    const id = insertDevinSubscription(s);
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    expect(
      (
        await req(s.app, 'PATCH', `${path}/${id}`, {
          models: [{ id: 'swe-2-1', name: 'SWE-2.1', thinkingDefault: 'xhigh' }],
        })
      ).status,
    ).toBe(200);
    const result = req(s.app, 'POST', `${path}/${id}/test`, { model: 'swe-2-1' });
    const requestId = await sent.promise;
    const machineRequest = (
      machine: { token: string; connectionId: string },
      body: object,
    ) =>
      s.app.request(`/api/machine/provider/model-test/${requestId}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(
      (await machineRequest(ineligible, { phase: 'claim', connectionId: ineligible.connectionId }))
        .status,
    ).toBe(404);
    const claim = await machineRequest(runner, {
      phase: 'claim',
      connectionId: runner.connectionId,
    });
    expect(await claim.json()).toMatchObject({ mode: 'devin', model: 'swe-2-1-xhigh' });
    expect(
      (
        await machineRequest(runner, {
          phase: 'result',
          connectionId: runner.connectionId,
          result: { status: 'ok' },
        })
      ).status,
    ).toBe(200);
    expect(await (await result).json()).toMatchObject({ status: 'ok', failure: null });
    expect(events).toContain('provider.model-test');
    expect(ineligibleEvents).not.toContain('provider.model-test');
  });

  test('refuses a model the subscription does not offer', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const id = insertDevinSubscription(s);
    const path = `/api/teams/${s.team.id}/devin-subscriptions/${id}/test`;
    const result = await req(s.app, 'POST', path, { model: 'nothing-like-this' });
    expect(result.status).toBe(400);
  });

  test('fails a test when the subscription expired, before any Runner is woken', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const events: string[] = [];
    attachRunner(s, RUNNER_ONLINE, events);
    const id = insertDevinSubscription(s, { expiresAt: Date.now() - 1_000 });
    const path = `/api/teams/${s.team.id}/devin-subscriptions/${id}/test`;
    const result = await req(s.app, 'POST', path, { model: 'swe-2-1' });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ status: 'failed', failure: 'auth' });
    expect(events).not.toContain('provider.model-test');
  });
});

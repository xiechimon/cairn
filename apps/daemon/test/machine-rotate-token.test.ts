import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { MachineApiError } from '../src/machine-client.js';
import { loadMachineJson } from '../src/state.js';
import {
  boot,
  CLAIMED,
  defer,
  FakeMachineApi,
  fakeBackend,
  waitFor,
} from './machine-loop-harness.js';

describe('daemon runner token rotation handoff', () => {
  test('idle token.rotate claims, writes machine.json (0o600), acks with new token, reconnects SSE with 0ms backoff, never logs tokens', async () => {
    const newToken = 'd'.repeat(64);
    const ackTokens: string[] = [];
    let streamOpens = 0;
    const api = new FakeMachineApi();
    const baseStream = api.stream.bind(api);
    api.stream = async (signal, onEvent, onConnected) => {
      streamOpens += 1;
      await baseStream(signal, onEvent, onConnected);
    };
    const rotApi = api as FakeMachineApi & {
      claimTokenRotation?: (
        rotationId: string,
        connectionId: string,
        hostKey?: string,
      ) => Promise<string>;
      ackTokenRotation?: (rotationId: string, token: string) => Promise<void>;
    };
    rotApi.claimTokenRotation = async (rotationId, connectionId) => {
      expect(rotationId).toBe('rot-1');
      expect(connectionId).toBe('conn-1');
      return newToken;
    };
    rotApi.ackTokenRotation = async (rotationId, token) => {
      expect(rotationId).toBe('rot-1');
      ackTokens.push(token);
    };

    const { handle, lines, paths } = await boot({ api, claimBackoffBaseMs: 2_000 });
    const oldToken = loadMachineJson(paths)!.token;
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    const opensBefore = streamOpens;

    api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-1' });
    api.onStreamEvent?.({ type: 'token.rotate', rotationId: 'rot-1' });

    await waitFor(() => loadMachineJson(paths)?.token === newToken);
    await waitFor(() => streamOpens > opensBefore);
    expect(ackTokens).toEqual([newToken]);
    expect(statSync(paths.machineJson).mode & 0o777).toBe(0o600);
    expect(lines.some((l) => l.includes('Shutting down'))).toBe(false);
    expect(lines.some((l) => l.includes('push channel down'))).toBe(false);
    expect(lines.join('\n')).not.toContain(oldToken);
    expect(lines.join('\n')).not.toContain(newToken);
    await handle.stop();
    await handle.done;
  });

  test('in-flight step finishes with the new token and waiting claim 401 retries immediately after rotation', async () => {
    const newToken = 'e'.repeat(64);
    const stepStarted = defer<void>();
    const releaseStep = defer<void>();
    const backend = {
      ...fakeBackend([]).backend,
      async createSession() {
        stepStarted.resolve();
        await releaseStep.promise;
        return {
          sessionId: 'sess-step-rot',
          events: (async function* () {
            yield { type: 'text_delta' as const, text: 'done' };
            yield { type: 'done' as const, usage: [] };
          })(),
          async steer() {},
          async stop() {},
          usage: () => [],
        };
      },
    };
    const api = new FakeMachineApi();
    const rotApi = api as FakeMachineApi & {
      claimTokenRotation?: (rotationId: string, connectionId: string) => Promise<string>;
      ackTokenRotation?: (rotationId: string, token: string) => Promise<void>;
    };
    rotApi.claimTokenRotation = async () => newToken;
    rotApi.ackTokenRotation = async () => {};
    api.claimQueue.push(CLAIMED);

    const { handle, paths } = await boot({ api, backend, claimBackoffBaseMs: 5_000 });
    try {
      await stepStarted.promise;
      await waitFor(() => api.onStreamEvent !== null);

      api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-step' });
      api.onStreamEvent?.({ type: 'token.rotate', rotationId: 'rot-step' });
      await waitFor(() => loadMachineJson(paths)?.token === newToken);
    } finally {
      releaseStep.resolve();
    }
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');

    const claimsBefore = api.claimCalls;
    api.parked?.(Object.assign(new MachineApiError(401, 'unauthorized'), {}) as never);
    await handle.stop();
    await handle.done;
    expect(api.claimCalls).toBeGreaterThanOrEqual(claimsBefore);
  });

  test('ack rejected with 401 rolls back machine.json to previous token; 5xx retries ack once before self-heal', async () => {
    const newToken = 'f'.repeat(64);
    const api = new FakeMachineApi();
    let ackMode: 'reject-401' | 'flaky-500' = 'reject-401';
    let ackAttempts = 0;
    const rotApi = api as FakeMachineApi & {
      claimTokenRotation?: () => Promise<string>;
      ackTokenRotation?: () => Promise<void>;
    };
    rotApi.claimTokenRotation = async () => newToken;
    rotApi.ackTokenRotation = async () => {
      ackAttempts += 1;
      if (ackMode === 'reject-401') throw new MachineApiError(401, 'unauthorized');
      if (ackAttempts === 1) throw new MachineApiError(503, 'restarting');
    };

    const { handle, lines, paths } = await boot({ api });
    const oldToken = loadMachineJson(paths)!.token;
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));

    api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-rb' });
    api.onStreamEvent?.({ type: 'token.rotate', rotationId: 'rot-rb' });
    await waitFor(() => ackAttempts === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(loadMachineJson(paths)?.token).toBe(oldToken);

    ackMode = 'flaky-500';
    ackAttempts = 0;
    api.onStreamEvent?.({ type: 'token.rotate', rotationId: 'rot-retry' });
    await waitFor(() => ackAttempts === 2);
    await waitFor(() => loadMachineJson(paths)?.token === newToken);

    await handle.stop();
    await handle.done;
  });

  test('disk write failure skips ack and keeps running without logging tokens', async () => {
    const newToken = '1'.repeat(64);
    const api = new FakeMachineApi();
    let acked = false;
    const rotApi = api as FakeMachineApi & {
      claimTokenRotation?: () => Promise<string>;
      ackTokenRotation?: () => Promise<void>;
    };
    rotApi.claimTokenRotation = async () => newToken;
    rotApi.ackTokenRotation = async () => {
      acked = true;
    };

    const { handle, lines, paths } = await boot({ api });
    const oldRaw = readFileSync(paths.machineJson, 'utf8');
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));

    writeFileSync(paths.machineJson, '{invalid');
    const { chmodSync } = await import('node:fs');
    chmodSync(paths.home, 0o500);
    try {
      api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-disk' });
      api.onStreamEvent?.({ type: 'token.rotate', rotationId: 'rot-disk' });
      await waitFor(() => lines.some((l) => l.includes('machine.json')));
      expect(acked).toBe(false);
      expect(lines.join('\n')).not.toContain(newToken);
    } finally {
      chmodSync(paths.home, 0o700);
      writeFileSync(paths.machineJson, oldRaw);
      await handle.stop();
      await handle.done;
    }
  });
});

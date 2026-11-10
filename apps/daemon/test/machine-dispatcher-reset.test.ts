import { getGlobalDispatcher } from 'undici';
import { describe, expect, test } from 'vitest';
import { MachineApiError } from '../src/machine-client.js';
import { boot, FakeMachineApi, waitFor } from './machine-loop-harness.js';

type Outcome = 'network' | 'http' | 'ok' | 'hang';

class ScriptedPresenceApi extends FakeMachineApi {
  attempts = 0;
  constructor(private readonly script: Outcome[]) {
    super();
  }
  async presence(body?: Parameters<FakeMachineApi['presence']>[0]) {
    const outcome = this.script[this.attempts] ?? 'ok';
    this.attempts += 1;
    if (outcome === 'network') throw new TypeError('fetch failed');
    if (outcome === 'http') throw new MachineApiError(502, 'bad gateway');
    if (outcome === 'hang') await new Promise<never>(() => {});
    await super.presence(body);
  }
}

async function run(script: Outcome[], attemptsWanted: number) {
  const api = new ScriptedPresenceApi(['ok', 'ok', ...script]);
  const { handle, lines } = await boot({
    api,
    presenceIntervalMs: 50,
    presenceTimeoutMs: 30,
  });
  const before = getGlobalDispatcher();
  const initialAttempts = api.attempts;
  try {
    await waitFor(() => api.attempts - initialAttempts >= attemptsWanted, 5_000);
    await new Promise((r) => setTimeout(r, 100));
    const resets = lines.filter((l) =>
      l.includes('http dispatcher reset after 3 network failures'),
    );
    return { resets: resets.length, replaced: getGlobalDispatcher() !== before };
  } finally {
    await handle.stop();
    await handle.done;
  }
}

describe('presence network failures reset the http dispatcher', () => {
  test('three consecutive network failures reset exactly once', async () => {
    const result = await run(['network', 'network', 'network', 'ok', 'ok', 'ok'], 6);
    expect(result.resets).toBe(1);
    expect(result.replaced).toBe(true);
  });

  test('an HTTP error between failures resets the counter', async () => {
    const result = await run(['network', 'network', 'http', 'network', 'network', 'ok'], 6);
    expect(result.resets).toBe(0);
    expect(result.replaced).toBe(false);
  });

  test('a success resets the counter', async () => {
    const result = await run(['network', 'network', 'ok', 'network', 'network', 'ok'], 6);
    expect(result.resets).toBe(0);
    expect(result.replaced).toBe(false);
  });

  test('a presence call that never settles counts as a failure after the timeout', async () => {
    const result = await run(['hang', 'hang', 'hang', 'ok', 'ok'], 5);
    expect(result.resets).toBe(1);
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { bootServer, issueApiKey, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

async function call(s: TestServer, method: string, path: string, cred: string, body?: unknown) {
  return s.app.request(path, {
    method,
    headers: {
      'x-cairn-raw-send': '1',
      authorization: `Bearer ${cred}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('a runner from before desktop-v0.1.712', () => {
  test('gets its confinement report acknowledged, so it boots instead of retrying forever', async () => {
    const s = bootServer({ claimHoldMs: 100 });
    servers.push(s);
    const key = await issueApiKey(s);
    const base = { mcpServers: [], skills: [], osPlatform: 'darwin' };
    const enrolled = await call(
      s,
      'POST',
      '/api/machine/enroll',
      key,
      readyMachine({ teamId: s.team.id, name: 'pre-0.1.712', cliVersion: '0.2.3' }),
    );
    const { token } = (await enrolled.json()) as { token: string };
    const handshake = async (report: Record<string, unknown>) => {
      await call(s, 'POST', '/api/machine/presence', token, {
        cliVersion: '0.2.3',
        capabilities: { ...base, confinement: report },
      });
      const me = (await (await call(s, 'GET', '/api/machine/me', token)).json()) as {
        capabilities?: { confinement?: unknown };
      };
      return me.capabilities?.confinement;
    };

    const checking = { state: 'checking', invocation: randomUUID(), generation: 1, revision: 1 };
    expect(await handshake(checking)).toEqual(checking);
    const ready = { ...checking, state: 'ready', revision: 2 };
    expect(await handshake(ready)).toEqual(ready);
  });
});

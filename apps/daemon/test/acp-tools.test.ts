import { describe, expect, test, vi } from 'vitest';
import { openAcpTools } from '../src/backend/acp-tools.js';

const opts = {
  cwd: process.cwd(),
  modelId: 'stub-model',
  provider: { kind: 'api_key' as const, providerId: 'openai' },
};

describe('ACP host tools lifecycle', () => {
  test('listener requires authorization, rejects browser requests, and closes after the session', async () => {
    const bridge = await openAcpTools({
      ...opts,
      localTools: [{ name: 'local', description: 'Local', execute: async () => '' }],
    });
    expect(bridge).not.toBeNull();
    if (!bridge) throw new Error('Missing bridge');
    const { url, headers } = bridge.declaration;
    try {
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      const authorized = Object.fromEntries(headers.map(({ name, value }) => [name, value]));
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { ...authorized, origin: 'https://example.com' },
          })
        ).status,
      ).toBe(403);
      expect((await fetch(url, { headers: authorized })).status).toBe(405);
      expect((await fetch(url, { method: 'POST', headers: authorized, body: '{' })).status).toBe(
        400,
      );
    } finally {
      bridge.close();
    }
    await expect(fetch(url)).rejects.toThrow();
  });

  test('does not open a listener for an empty tool set', async () => {
    await expect(openAcpTools(opts)).resolves.toBeNull();
  });

  test('duplicate tool names fail before invocation', async () => {
    const execute = vi.fn(async () => '');
    await expect(
      openAcpTools({
        ...opts,
        remoteTools: [{ name: 'same', description: 'Remote' }],
        executeRemoteTool: execute,
        localTools: [{ name: 'same', description: 'Local', execute }],
      }),
    ).rejects.toThrow('unique');
    expect(execute).not.toHaveBeenCalled();
  });
});

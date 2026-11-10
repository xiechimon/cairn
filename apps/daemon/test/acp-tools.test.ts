import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
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

  test.each(['create_todo', 'update_todo'])(
    'forwards stale %s category arguments without stripping them',
    async (name) => {
      const execute = vi.fn(async () => 'ok');
      const bridge = await openAcpTools({
        ...opts,
        remoteTools: CHIEF_REMOTE_TOOLS.filter((tool) => tool.name === name),
        executeRemoteTool: execute,
      });
      if (!bridge) throw new Error('Missing bridge');
      const { url, headers } = bridge.declaration;
      try {
        for (const tagIds of [[], null, 'bug', ['retired']]) {
          const args = { projectId: 'fixture-project', todoId: 'fixture-task', tagIds };
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              ...Object.fromEntries(headers.map(({ name, value }) => [name, value])),
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name, arguments: args },
            }),
          });
          expect(response.status).toBe(200);
          expect(execute).toHaveBeenLastCalledWith(name, args);
        }
      } finally {
        bridge.close();
      }
    },
  );

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

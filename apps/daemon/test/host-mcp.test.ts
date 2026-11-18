import { connect } from 'node:net';
import type { LocalToolDef } from '@cairn/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { HOST_MCP_TOKEN_ENV, openHostMcpBridge } from '../src/engine/host-mcp.js';

const dirs: string[] = [];

function takeDir(): string {
  const dir = makeTestTempDir('host-mcp-test-');
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function rpc(
  socketPath: string,
  token: string,
  messages: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const replies: Record<string, unknown>[] = [];
    let rest = '';
    socket.on('data', (chunk) => {
      rest += chunk.toString('utf8');
      let idx = rest.indexOf('\n');
      while (idx >= 0) {
        const line = rest.slice(0, idx);
        rest = rest.slice(idx + 1);
        idx = rest.indexOf('\n');
        if (line.trim() === '') continue;
        replies.push(JSON.parse(line) as Record<string, unknown>);
        if (replies.length === messages.length) {
          socket.end();
          resolve(replies);
        }
      }
    });
    socket.on('connect', () => {
      socket.write(`${token}\n`);
      for (const message of messages) socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.on('error', reject);
  });
}

function expectRefused(socketPath: string, firstLine: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.on('connect', () => {
      socket.write(
        `${firstLine}\n${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
      );
    });
    socket.on('data', () => reject(new Error('replied to an unauthenticated connection')));
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}

const askHost: LocalToolDef = {
  name: 'ask_host',
  description: 'ask the host',
  parameters: {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
  },
  execute: (params) => Promise.resolve(`answer:${String(params.q)}`),
};

describe('host mcp bridge', () => {
  it('refuses connections without the per-bridge token and serves authenticated ones', async () => {
    const bridge = await openHostMcpBridge({
      dir: takeDir(),
      remoteTools: [],
      localTools: [askHost],
    });
    expect(bridge).not.toBeNull();
    if (bridge === null) return;
    try {
      await expectRefused(bridge.socketPath, 'wrong-token');
      await expectRefused(bridge.socketPath, '');
      const token = bridge.env[HOST_MCP_TOKEN_ENV];
      expect(token).toMatch(/^[a-f0-9]{48}$/);
      const replies = await rpc(bridge.socketPath, String(token), [
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ]);
      expect(replies[0]).toMatchObject({ id: 1 });
      const listed = (replies[1] as { result: { tools: { name: string }[] } }).result.tools;
      expect(listed.map((tool) => tool.name)).toEqual(['ask_host']);
    } finally {
      bridge.close();
    }
  });

  it('rejects a tools/call whose arguments fail the schema and executes valid ones', async () => {
    const bridge = await openHostMcpBridge({
      dir: takeDir(),
      remoteTools: [],
      localTools: [askHost],
    });
    if (bridge === null) throw new Error('bridge missing');
    try {
      const token = String(bridge.env[HOST_MCP_TOKEN_ENV]);
      const replies = await rpc(bridge.socketPath, token, [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'ask_host', arguments: {} },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'ask_host', arguments: { q: 'hi' } },
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'missing_tool', arguments: {} },
        },
      ]);
      const byId = new Map(replies.map((reply) => [reply.id, reply]));
      const invalid = (
        byId.get(1) as { result: { isError?: boolean; content: { text: string }[] } }
      ).result;
      expect(invalid.isError).toBe(true);
      expect(invalid.content[0]?.text).toContain('rejected');
      const valid = (byId.get(2) as { result: { isError?: boolean; content: { text: string }[] } })
        .result;
      expect(valid.isError).toBeUndefined();
      expect(valid.content[0]?.text).toBe('answer:hi');
      const missing = (
        byId.get(3) as { result: { isError?: boolean; content: { text: string }[] } }
      ).result;
      expect(missing.isError).toBe(true);
      expect(missing.content[0]?.text).toContain('unknown tool');
    } finally {
      bridge.close();
    }
  });
});

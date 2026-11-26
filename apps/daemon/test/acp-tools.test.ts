import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test, vi } from 'vitest';
import { bridgeHttpMcpToStdio, openAcpTools } from '../src/backend/acp-tools.js';

const opts = {
  cwd: process.cwd(),
  modelId: 'stub-model',
  provider: { kind: 'api_key' as const, providerId: 'openai' },
};

function spawnStdioRpc(declaration: { command: string; args: string[] }) {
  const child = spawn(declaration.command, declaration.args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiters = new Map<number, (msg: Record<string, unknown>) => void>();
  const responses = new Map<number, Record<string, unknown>>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as Record<string, unknown>;
    const id = typeof msg.id === 'number' ? msg.id : -1;
    const waiter = waiters.get(id);
    if (waiter) {
      waiters.delete(id);
      waiter(msg);
    } else {
      responses.set(id, msg);
    }
  });
  let nextId = 1;
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId++;
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      const existing = responses.get(id);
      if (existing) {
        responses.delete(id);
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => reject(new Error(`RPC timeout on ${method}`)), 5_000);
      waiters.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return response;
  };
  return {
    child,
    call,
    close: () => {
      child.stdin.end();
      child.kill('SIGTERM');
    },
  };
}

describe('ACP stdio host tools lifecycle', () => {
  test('requires TCP token auth, serves MCP over stdio relay, and closes sockets cleanly', async () => {
    const bridge = await openAcpTools({
      ...opts,
      localTools: [{ name: 'local', description: 'Local', execute: async () => 'ran local' }],
    });
    expect(bridge).not.toBeNull();
    if (!bridge) throw new Error('Missing bridge');
    expect('url' in bridge.declaration).toBe(false);

    const badTokenReply = await new Promise<string>((resolve, reject) => {
      const sock = createConnection(bridge.port, '127.0.0.1', () => {
        sock.write('wrong-token\n{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
      });
      let out = '';
      sock.on('data', (chunk) => {
        out += chunk.toString('utf8');
      });
      sock.on('close', () => resolve(out));
      sock.on('error', reject);
    });
    expect(JSON.parse(badTokenReply.trim())).toMatchObject({
      error: { code: -32001, message: 'Unauthorized' },
    });

    const rpc = spawnStdioRpc(bridge.declaration);
    try {
      await rpc.call('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
      const listed = (await rpc.call('tools/list')) as {
        result: { tools: Array<{ name: string }> };
      };
      expect(listed.result.tools.map((t) => t.name)).toEqual(['local']);
      const called = (await rpc.call('tools/call', { name: 'local', arguments: {} })) as {
        result: { content: Array<{ text: string }> };
      };
      expect(called.result.content[0]?.text).toBe('ran local');
    } finally {
      rpc.close();
      bridge.close();
    }

    await new Promise<void>((resolve) => {
      const sock = createConnection(bridge.port, '127.0.0.1');
      sock.once('error', () => resolve());
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
    });
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
      const rpc = spawnStdioRpc(bridge.declaration);
      try {
        await rpc.call('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        });
        for (const tagIds of [[], null, 'bug', ['retired']]) {
          const args = { projectId: 'fixture-project', todoId: 'fixture-task', tagIds };
          const res = (await rpc.call('tools/call', { name, arguments: args })) as {
            result: { content: Array<{ text: string }> };
          };
          expect(res.result.content[0]?.text).toBe('ok');
          expect(execute).toHaveBeenLastCalledWith(name, args);
        }
      } finally {
        rpc.close();
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

  test.each([
    ['lockedDown', { lockedDown: true }],
    ['readOnly', { readOnly: true }],
    ['remoteToolsOnly', { remoteToolsOnly: true }],
  ] as const)(
    'annotates every host tool with readOnlyHint: true on %s turns',
    async (_label, policy) => {
      const bridge = await openAcpTools({
        ...opts,
        ...policy,
        remoteTools: [{ name: 'todos', description: 'Read todos' }],
        executeRemoteTool: async () => '[]',
        localTools: [{ name: 'local', description: 'Local', execute: async () => 'ok' }],
      });
      if (!bridge) throw new Error('Missing bridge');
      const rpc = spawnStdioRpc(bridge.declaration);
      try {
        await rpc.call('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        });
        const listed = (await rpc.call('tools/list')) as {
          result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
        };
        expect(listed.result.tools.map((t) => t.name)).toEqual(['todos', 'local']);
        for (const tool of listed.result.tools) {
          expect(tool.annotations).toEqual({ readOnlyHint: true });
        }
      } finally {
        rpc.close();
        bridge.close();
      }
    },
  );

  test('omits tool annotations on normal turns', async () => {
    const bridge = await openAcpTools({
      ...opts,
      remoteTools: [{ name: 'todos', description: 'Read todos' }],
      executeRemoteTool: async () => '[]',
      localTools: [{ name: 'local', description: 'Local', execute: async () => 'ok' }],
    });
    if (!bridge) throw new Error('Missing bridge');
    const rpc = spawnStdioRpc(bridge.declaration);
    try {
      await rpc.call('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
      const listed = (await rpc.call('tools/list')) as {
        result: { tools: Array<{ name: string; annotations?: unknown }> };
      };
      expect(listed.result.tools.map((t) => t.name)).toEqual(['todos', 'local']);
      for (const tool of listed.result.tools) {
        expect('annotations' in tool).toBe(false);
        expect(tool.annotations).toBeUndefined();
      }
    } finally {
      rpc.close();
      bridge.close();
    }
  });

  test('bridges external HTTP MCP connectors onto stdio and refuses redirects without leaking auth headers', async () => {
    let seenAuth: string | undefined;
    let leakedToRedirectTarget = false;

    const redirectTarget = createHttpServer((req, res) => {
      if (req.headers.authorization !== undefined) leakedToRedirectTarget = true;
      res.writeHead(200).end();
    });
    await new Promise<void>((resolve) => redirectTarget.listen(0, '127.0.0.1', resolve));
    const targetAddr = redirectTarget.address() as { port: number };

    const upstream = createHttpServer(async (req, res) => {
      if (req.url === '/redir') {
        res.writeHead(302, { location: `http://127.0.0.1:${targetAddr.port}/leak` }).end();
        return;
      }
      seenAuth = req.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body =
        chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const server = new Server({ name: 'ext', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [{ name: 'ext_ping', description: 'Ping', inputSchema: { type: 'object' } }],
      }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
        content: [{ type: 'text', text: `${params.name} output` }],
      }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.once('close', () => void server.close().catch(() => {}));
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamAddr = upstream.address() as { port: number };

    const bridge = await bridgeHttpMcpToStdio({
      slug: 'ext',
      transport: 'http',
      url: `http://127.0.0.1:${upstreamAddr.port}/mcp`,
      headers: { Authorization: 'Bearer ext-secret' },
    });
    const rpc = spawnStdioRpc(bridge.declaration);
    try {
      await rpc.call('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
      const listed = (await rpc.call('tools/list')) as {
        result: { tools: Array<{ name: string; annotations?: Record<string, unknown> }> };
      };
      expect(listed.result.tools.map((t) => t.name)).toEqual(['ext_ping']);
      expect(listed.result.tools[0]?.annotations).toBeUndefined();
      const called = (await rpc.call('tools/call', { name: 'ext_ping', arguments: {} })) as {
        result: { content: Array<{ text: string }> };
      };
      expect(called.result.content[0]?.text).toBe('ext_ping output');
      expect(seenAuth).toBe('Bearer ext-secret');
    } finally {
      rpc.close();
      bridge.close();
    }

    const redirBridge = await bridgeHttpMcpToStdio({
      slug: 'redir',
      transport: 'http',
      url: `http://127.0.0.1:${upstreamAddr.port}/redir`,
      headers: { Authorization: 'Bearer should-not-leak' },
    });
    const redirRpc = spawnStdioRpc(redirBridge.declaration);
    try {
      await redirRpc.call('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
      const res = await redirRpc.call('tools/list');
      expect(res.error).toBeDefined();
      expect(leakedToRedirectTarget).toBe(false);
    } finally {
      redirRpc.close();
      redirBridge.close();
      upstream.close();
      upstream.closeAllConnections();
      redirectTarget.close();
      redirectTarget.closeAllConnections();
    }
  });
});

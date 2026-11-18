import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import type { McpServerStdio } from '@agentclientprotocol/sdk';
import type { McpEndpoint, SessionOpts } from '@cairn/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DAEMON_VERSION } from '../version.js';

const AUTH_TIMEOUT_MS = 5_000;
const MAX_AUTH_HEADER_BYTES = 256;

const STDIO_RELAY_SCRIPT = [
  "import net from 'node:net';",
  'const [port, token] = process.argv.slice(1);',
  "const socket = net.createConnection(Number(port), '127.0.0.1', () => {",
  '  socket.setNoDelay(true);',
  "  socket.write(token + '\\n');",
  '  process.stdin.pipe(socket);',
  '  socket.pipe(process.stdout);',
  '});',
  "process.stdout.on('error', () => process.exit(0));",
  "socket.on('close', () => process.exit(0));",
  "socket.on('error', () => process.exit(1));",
].join('\n');

export interface AcpStdioBridge {
  declaration: McpServerStdio;
  port: number;
  token: string;
  toolNames: readonly string[];
  close: () => void;
}

function tokensMatch(supplied: Buffer, expected: Buffer): boolean {
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function openStdioMcpListener(
  name: string,
  toolNames: readonly string[],
  registerHandlers: (server: Server) => void,
  onClose?: () => void,
): Promise<AcpStdioBridge> {
  const token = randomBytes(32).toString('hex');
  const expectedToken = Buffer.from(token, 'utf8');
  const activeServers = new Set<Server>();
  const activeSockets = new Set<Socket>();
  let closed = false;

  const listener = createServer((socket) => {
    if (closed) {
      socket.destroy();
      return;
    }
    activeSockets.add(socket);
    socket.setNoDelay(true);

    const chunks: Buffer[] = [];
    let size = 0;
    let authenticated = false;

    const authTimer = setTimeout(() => {
      if (!authenticated) socket.destroy();
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_AUTH_HEADER_BYTES) {
        cleanupAuth();
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      const joined = chunks.length === 1 ? (chunks[0] ?? Buffer.alloc(0)) : Buffer.concat(chunks);
      const nl = joined.indexOf(0x0a);
      if (nl === -1) return;

      cleanupAuth();
      const supplied = joined.subarray(0, nl);
      if (!tokensMatch(supplied, expectedToken)) {
        socket.end(
          `${JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' } })}\n`,
          () => socket.destroy(),
        );
        return;
      }

      authenticated = true;
      const input = new PassThrough();
      const rest = joined.subarray(nl + 1);
      if (rest.length > 0) input.write(rest);
      socket.pipe(input);

      const server = new Server(
        { name: 'cairn', version: DAEMON_VERSION },
        { capabilities: { tools: {} } },
      );
      registerHandlers(server);
      const transport = new StdioServerTransport(input, socket);
      activeServers.add(server);
      socket.once('close', () => {
        activeServers.delete(server);
        input.end();
        void server.close().catch(() => {});
      });
      void server.connect(transport).catch(() => {
        socket.destroy();
      });
    };

    const cleanupAuth = () => {
      clearTimeout(authTimer);
      socket.off('data', onData);
    };

    socket.on('data', onData);
    socket.once('error', () => {
      cleanupAuth();
    });
    socket.once('close', () => {
      cleanupAuth();
      activeSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      listener.off('error', reject);
      resolve();
    });
  });

  const address = listener.address();
  if (address === null || typeof address === 'string') {
    listener.close();
    throw new Error('ACP stdio MCP listener has no address');
  }

  return {
    declaration: {
      name,
      command: process.execPath,
      args: ['--input-type=module', '-e', STDIO_RELAY_SCRIPT, String(address.port), token],
      env: [],
    },
    port: address.port,
    token,
    toolNames,
    close: () => {
      if (closed) return;
      closed = true;
      listener.close();
      for (const socket of activeSockets) socket.destroy();
      activeSockets.clear();
      for (const server of activeServers) void server.close().catch(() => {});
      activeServers.clear();
      onClose?.();
    },
  };
}

export async function openAcpTools(opts: SessionOpts): Promise<AcpStdioBridge | null> {
  const remote = opts.remoteTools ?? [];
  const local = opts.localTools ?? [];
  if (remote.length === 0 && local.length === 0) return null;
  if (remote.length > 0 && !opts.executeRemoteTool) throw new Error('ACP tools require a relay');
  const names = [...remote, ...local].map((tool) => tool.name);
  if (new Set(names).size !== names.length) throw new Error('ACP host tool names must be unique');
  const definitions = [...remote, ...local].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z
      .object({ type: z.literal('object') })
      .loose()
      .parse(tool.parameters ?? { type: 'object', properties: {} }),
  }));

  return openStdioMcpListener('cairn', names, (server) => {
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: definitions }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const localTool = local.find((tool) => tool.name === params.name);
      const remoteTool = remote.find((tool) => tool.name === params.name);
      if (!localTool && !remoteTool) throw new Error('Undeclared ACP host tool');
      try {
        const text = localTool
          ? await localTool.execute(params.arguments ?? {})
          : await opts.executeRemoteTool?.(params.name, params.arguments ?? {});
        return { content: [{ type: 'text', text: text ?? '' }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  });
}

export async function bridgeHttpMcpToStdio(endpoint: McpEndpoint): Promise<AcpStdioBridge> {
  if (endpoint.transport !== 'http' || endpoint.url === undefined) {
    throw new Error(`Cannot bridge non-HTTP MCP endpoint ${endpoint.slug}`);
  }
  const targetUrl = new URL(endpoint.url);
  const headers = endpoint.headers ?? {};
  const clients = new Set<Client>();
  let pendingClient: Promise<Client> | null = null;

  const getClient = () => {
    if (pendingClient !== null) return pendingClient;
    pendingClient = (async () => {
      const client = new Client({ name: 'cairn', version: DAEMON_VERSION });
      const transport = new StreamableHTTPClientTransport(targetUrl, {
        requestInit: { headers },
        fetch: (input, init) => fetch(input, { ...init, redirect: 'manual' }),
      });
      await client.connect(transport);
      clients.add(client);
      return client;
    })().catch((error) => {
      pendingClient = null;
      throw error;
    });
    return pendingClient;
  };

  return openStdioMcpListener(
    endpoint.slug,
    [],
    (server) => {
      server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
        const client = await getClient();
        return client.listTools(params);
      });
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const client = await getClient();
        return client.callTool({
          name: params.name,
          ...(params.arguments !== undefined ? { arguments: params.arguments } : {}),
        });
      });
    },
    () => {
      for (const client of clients) void client.close().catch(() => {});
      clients.clear();
      pendingClient = null;
    },
  );
}

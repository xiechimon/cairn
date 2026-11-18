import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import type { LocalToolDef, RemoteToolDef } from '@cairn/shared';
import { z } from 'zod';
import { parametersToShape } from '../backend/claude-code.js';

export const HOST_MCP_TOKEN_ENV = 'CAIRN_HOST_MCP_TOKEN';

const BRIDGE_SCRIPT = `import { connect } from 'node:net';
import { createInterface } from 'node:readline';
const socket = connect(process.argv[2]);
socket.on('error', () => process.exit(1));
socket.write(String(process.env.CAIRN_HOST_MCP_TOKEN ?? '') + '\\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => socket.write(line + '\\n'));
rl.on('close', () => socket.end());
let rest = '';
socket.on('data', (chunk) => {
  rest += chunk.toString('utf8');
  let i = rest.indexOf('\\n');
  while (i >= 0) {
    process.stdout.write(rest.slice(0, i + 1));
    rest = rest.slice(i + 1);
    i = rest.indexOf('\\n');
  }
});
socket.on('close', () => process.exit(0));
`;

interface HostTool {
  name: string;
  description: string;
  inputSchema: unknown;
  schema: z.ZodType;
  execute(params: Record<string, unknown>): Promise<string>;
}

export interface HostMcpBridge {
  readonly socketPath: string;
  readonly command: readonly string[];
  readonly env: Record<string, string>;
  close(): void;
}

export interface HostMcpBridgeOpts {
  dir: string;
  remoteTools: readonly RemoteToolDef[];
  relay?: (name: string, params: Record<string, unknown>) => Promise<string>;
  localTools: readonly LocalToolDef[];
}

export async function openHostMcpBridge(opts: HostMcpBridgeOpts): Promise<HostMcpBridge | null> {
  const tools: HostTool[] = [
    ...opts.remoteTools.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.parameters,
      schema: z.object(parametersToShape(def.parameters, def.name)),
      execute: async (params: Record<string, unknown>) =>
        opts.relay === undefined
          ? `${def.name} rejected: relay unavailable`
          : opts.relay(def.name, params),
    })),
    ...opts.localTools.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.parameters,
      schema: z.object(parametersToShape(def.parameters, def.name)),
      execute: (params: Record<string, unknown>) => def.execute(params),
    })),
  ];
  if (tools.length === 0) return null;
  mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
  const socketPath = join(opts.dir, 'host-mcp.sock');
  const bridgePath = join(opts.dir, 'host-mcp-bridge.mjs');
  writeFileSync(bridgePath, BRIDGE_SCRIPT, { mode: 0o700 });
  const token = randomBytes(24).toString('hex');
  const server = createServer((socket) => serveSocket(socket, tools, token));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  return {
    socketPath,
    command: [process.execPath, bridgePath, socketPath],
    env: { [HOST_MCP_TOKEN_ENV]: token },
    close() {
      server.close();
      rmSync(opts.dir, { recursive: true, force: true });
    },
  };
}

function tokenMatches(line: string, token: string): boolean {
  const presented = Buffer.from(line.trim(), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function serveSocket(socket: Socket, tools: HostTool[], token: string): void {
  socket.setNoDelay(true);
  let authed = false;
  let rest = '';
  socket.on('data', (chunk: Buffer) => {
    rest += chunk.toString('utf8');
    let idx = rest.indexOf('\n');
    while (idx >= 0) {
      const line = rest.slice(0, idx);
      rest = rest.slice(idx + 1);
      idx = rest.indexOf('\n');
      if (!authed) {
        if (line.trim() === '') continue;
        authed = true;
        if (!tokenMatches(line, token)) {
          socket.destroy();
          return;
        }
        continue;
      }
      if (line.trim() === '') continue;
      void handleLine(socket, line, tools);
    }
  });
}

async function handleLine(socket: Socket, line: string, tools: HostTool[]): Promise<void> {
  let msg: { id?: unknown; method?: string; params?: unknown };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  const reply = (result: unknown) =>
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`);
  const fail = (code: number, message: string) =>
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } })}\n`);
  try {
    switch (msg.method) {
      case 'initialize':
        reply({
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'cairn-host', version: '1' },
        });
        return;
      case 'ping':
        reply({});
        return;
      case 'tools/list':
        reply({
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema ?? { type: 'object' },
          })),
        });
        return;
      case 'tools/call': {
        const params = msg.params as { name?: unknown; arguments?: unknown } | undefined;
        const tool = tools.find((entry) => entry.name === params?.name);
        if (tool === undefined) {
          reply({
            content: [{ type: 'text', text: `unknown tool ${String(params?.name)}` }],
            isError: true,
          });
          return;
        }
        const parsed = tool.schema.safeParse(
          typeof params?.arguments === 'object' && params.arguments !== null
            ? params.arguments
            : {},
        );
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          reply({
            content: [
              {
                type: 'text',
                text: `${tool.name} rejected: invalid arguments${issue === undefined ? '' : ` (${issue.path.join('.')}: ${issue.message})`}`,
              },
            ],
            isError: true,
          });
          return;
        }
        try {
          const text = await tool.execute(parsed.data as Record<string, unknown>);
          reply({ content: [{ type: 'text', text }] });
        } catch (error) {
          reply({
            content: [
              {
                type: 'text',
                text: `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          });
        }
        return;
      }
      default:
        fail(-32601, 'method not found');
    }
  } catch (error) {
    fail(-32603, error instanceof Error ? error.message : String(error));
  }
}

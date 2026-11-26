import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import type { McpServerStdio } from '@agentclientprotocol/sdk';
import {
  escapeRegExp,
  type McpEndpoint,
  type RemoteToolDef,
  type SessionOpts,
} from '@cairn/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DAEMON_VERSION } from '../version.js';
import { acpTurnPolicy } from './acp-permission-gate.js';
import { hostToolContent } from './host-tool-content.js';

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

export interface OpenAcpToolsOptions {
  maxToolBytes?: number;
  deferTools?: boolean;
}

export interface AcpStdioBridge {
  declaration: McpServerStdio;
  port: number;
  token: string;
  toolNames: readonly string[];
  systemPromptAppendix?: string;
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

const TOOL_SEARCH_NAME = 'tool_search';
const CALL_TOOL_NAME = 'call_tool';
const DEFAULT_TOOL_SEARCH_MAX_BYTES = 950;
const EMPTY_INPUT_SCHEMA: Record<string, unknown> = { type: 'object', properties: {} };

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint: boolean };
}

interface CompactedToolDoc {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

function toolByteLength(name: string, description: string, inputSchema: unknown): number {
  return Buffer.byteLength(JSON.stringify({ name, description, inputSchema }), 'utf8');
}

function firstSentence(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  const end = line.search(/[.。](\s|$)/);
  return end < 0 ? line : line.slice(0, end + 1);
}

function isSchemaPropertyMapKey(key: string): boolean {
  return (
    key === 'properties' || key === '$defs' || key === 'definitions' || key === 'patternProperties'
  );
}

function stripSchemaDescriptions(value: unknown, isPropertyMap = false): unknown {
  if (Array.isArray(value)) return value.map((item) => stripSchemaDescriptions(item, false));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isPropertyMap && key === 'description' && typeof entry === 'string') continue;
    const nextIsMap =
      !isPropertyMap &&
      isSchemaPropertyMapKey(key) &&
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry);
    out[key] = stripSchemaDescriptions(entry, nextIsMap);
  }
  return out;
}

function fitDescriptionToBytes(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  maxBytes: number,
): { description: string; inputSchema: Record<string, unknown> } {
  const suffix = ' (see system prompt)';
  const base = firstSentence(description) || description;
  const fullSummary = `${base}${suffix}`;
  if (toolByteLength(name, fullSummary, inputSchema) <= maxBytes) {
    return { description: fullSummary, inputSchema };
  }
  const chars = Array.from(base);
  let low = 0;
  let high = chars.length;
  let best = '';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const prefix = chars.slice(0, mid).join('').trimEnd();
    const candidate = prefix.length > 0 ? `${prefix}...${suffix}` : 'See system prompt';
    if (toolByteLength(name, candidate, inputSchema) <= maxBytes) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best !== '') return { description: best, inputSchema };
  for (const fallback of ['See system prompt', 'See prompt', '']) {
    if (toolByteLength(name, fallback, inputSchema) <= maxBytes) {
      return { description: fallback, inputSchema };
    }
  }
  return { description: '', inputSchema: EMPTY_INPUT_SCHEMA };
}

function buildToolSearchDescription(
  deferred: readonly RemoteToolDef[],
  inputSchema: Record<string, unknown>,
  maxBytes: number,
): string {
  const prefix = 'Search deferred Cairn tools by name or keyword. Available: ';
  const names = deferred.map((tool) => tool.name);
  const full = `${prefix}${names.join(', ')}`;
  if (toolByteLength(TOOL_SEARCH_NAME, full, inputSchema) <= maxBytes) return full;
  const chosen: string[] = [];
  for (const toolName of names) {
    const remaining = names.length - chosen.length - 1;
    const suffix = remaining > 0 ? `, ... (+${remaining} more)` : '';
    const candidate = `${prefix}${[...chosen, toolName].join(', ')}${suffix}`;
    if (toolByteLength(TOOL_SEARCH_NAME, candidate, inputSchema) > maxBytes) break;
    chosen.push(toolName);
  }
  if (chosen.length > 0) {
    const remaining = names.length - chosen.length;
    return `${prefix}${chosen.join(', ')}${remaining > 0 ? `, ... (+${remaining} more)` : ''}`;
  }
  return fitDescriptionToBytes(TOOL_SEARCH_NAME, prefix.trimEnd(), inputSchema, maxBytes)
    .description;
}

function searchDeferredTools(
  deferred: readonly RemoteToolDef[],
  rawQuery: unknown,
  rawLimit: unknown,
): string {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.floor(rawLimit)
      : 8;
  if (query === '' || query === '*') {
    const lines = deferred.map((tool) => `- ${tool.name}: ${firstSentence(tool.description)}`);
    return `Deferred Cairn tools (search by tool name for parameters, or invoke via ${CALL_TOOL_NAME}):\n${lines.join('\n')}`;
  }
  const exact = deferred.filter((tool) =>
    new RegExp(`\\b${escapeRegExp(tool.name)}\\b`, 'i').test(query),
  );
  const tokens = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  let matches: readonly RemoteToolDef[] = exact;
  if (matches.length === 0) {
    const scored = deferred
      .map((tool) => {
        const haystack = `${tool.name} ${tool.description}`.toLowerCase();
        const hits = tokens.filter((token) => haystack.includes(token)).length;
        return { tool, hits };
      })
      .filter((entry) => entry.hits > 0);
    const allMatched = scored.filter((entry) => entry.hits === tokens.length);
    const pool = allMatched.length > 0 ? allMatched : scored.sort((a, b) => b.hits - a.hits);
    matches = pool.map((entry) => entry.tool);
  }
  const selected = matches.slice(0, limit);
  if (selected.length === 0) return 'No matching deferred tools found.';
  const body = selected
    .map(
      (tool) =>
        `## ${tool.name}\n${tool.description}\nParameters: ${JSON.stringify(tool.parameters ?? EMPTY_INPUT_SCHEMA)}`,
    )
    .join('\n\n');
  return `Call any matching tool via ${CALL_TOOL_NAME} with { name, arguments }:\n\n${body}`;
}

export async function openAcpTools(
  opts: SessionOpts,
  options?: OpenAcpToolsOptions,
): Promise<AcpStdioBridge | null> {
  const remote = opts.remoteTools ?? [];
  const local = opts.localTools ?? [];
  if (remote.length === 0 && local.length === 0) return null;
  if (remote.length > 0 && !opts.executeRemoteTool) throw new Error('ACP tools require a relay');
  const allDeclaredNames = [...remote, ...local].map((tool) => tool.name);
  if (new Set(allDeclaredNames).size !== allDeclaredNames.length) {
    throw new Error('ACP host tool names must be unique');
  }
  const deferTools = options?.deferTools === true;
  const eagerRemote = deferTools ? remote.filter((tool) => tool.deferred !== true) : remote;
  const deferredRemote = deferTools ? remote.filter((tool) => tool.deferred === true) : [];
  const locked = acpTurnPolicy(opts) !== 'normal';

  const exposedTools: Array<{ name: string; description: string; parameters?: unknown }> = [
    ...eagerRemote,
    ...local,
  ];
  const hasDeferred = deferredRemote.length > 0;
  if (hasDeferred) {
    const toolSearchSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    };
    const callToolSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        arguments: { type: 'object' },
      },
      required: ['name'],
    };
    exposedTools.push(
      {
        name: TOOL_SEARCH_NAME,
        description: buildToolSearchDescription(
          deferredRemote,
          toolSearchSchema,
          options?.maxToolBytes ?? DEFAULT_TOOL_SEARCH_MAX_BYTES,
        ),
        parameters: toolSearchSchema,
      },
      {
        name: CALL_TOOL_NAME,
        description: 'Invoke a deferred Cairn tool found via tool_search.',
        parameters: callToolSchema,
      },
    );
  }
  const names = exposedTools.map((tool) => tool.name);
  if (new Set(names).size !== names.length) throw new Error('ACP host tool names must be unique');

  const rawDefinitions: McpToolDefinition[] = exposedTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z
      .object({ type: z.literal('object') })
      .loose()
      .parse(tool.parameters ?? EMPTY_INPUT_SCHEMA),
    ...(locked ? { annotations: { readOnlyHint: true } } : {}),
  }));

  const maxToolBytes = options?.maxToolBytes;
  const compactedDocs: CompactedToolDoc[] = [];
  const definitions: McpToolDefinition[] =
    maxToolBytes === undefined
      ? rawDefinitions
      : rawDefinitions.map((def) => {
          if (toolByteLength(def.name, def.description, def.inputSchema) <= maxToolBytes) {
            return def;
          }
          compactedDocs.push({
            name: def.name,
            description: def.description,
            parameters: def.inputSchema,
          });
          const strippedSchema = z
            .object({ type: z.literal('object') })
            .loose()
            .parse(stripSchemaDescriptions(def.inputSchema));
          const fitted = fitDescriptionToBytes(
            def.name,
            def.description,
            strippedSchema,
            maxToolBytes,
          );
          return {
            ...def,
            description: fitted.description,
            inputSchema: fitted.inputSchema,
          };
        });

  const systemPromptAppendix =
    compactedDocs.length > 0
      ? `## Cairn Tool Reference\n\n${compactedDocs
          .map(
            (doc) =>
              `### ${doc.name}\n${doc.description}\nParameters: ${JSON.stringify(doc.parameters ?? EMPTY_INPUT_SCHEMA)}`,
          )
          .join('\n\n')}`
      : undefined;

  const bridge = await openStdioMcpListener('cairn', names, (server) => {
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: definitions }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const args =
        typeof params.arguments === 'object' &&
        params.arguments !== null &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (hasDeferred && params.name === TOOL_SEARCH_NAME) {
        return {
          content: [
            {
              type: 'text',
              text: searchDeferredTools(deferredRemote, args.query, args.limit),
            },
          ],
        };
      }
      if (hasDeferred && params.name === CALL_TOOL_NAME) {
        const targetName = typeof args.name === 'string' ? args.name : '';
        const deferredTool = deferredRemote.find((tool) => tool.name === targetName);
        if (!deferredTool) {
          return {
            content: [
              {
                type: 'text',
                text: `${targetName || '(missing)'} is not an available deferred Cairn tool; find one with ${TOOL_SEARCH_NAME}.`,
              },
            ],
            isError: true,
          };
        }
        const rawToolArgs = args.arguments;
        const toolArgs =
          typeof rawToolArgs === 'object' && rawToolArgs !== null && !Array.isArray(rawToolArgs)
            ? (rawToolArgs as Record<string, unknown>)
            : {};
        try {
          const text = await opts.executeRemoteTool?.(deferredTool.name, toolArgs);
          return { content: hostToolContent(deferredTool.name, text ?? '') };
        } catch (error) {
          return {
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
            isError: true,
          };
        }
      }
      const localTool = local.find((tool) => tool.name === params.name);
      const remoteTool = eagerRemote.find((tool) => tool.name === params.name);
      if (!localTool && !remoteTool) throw new Error('Undeclared ACP host tool');
      try {
        const text = localTool
          ? await localTool.execute(params.arguments ?? {})
          : await opts.executeRemoteTool?.(params.name, params.arguments ?? {});
        return { content: hostToolContent(params.name, text ?? '') };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  });

  return {
    ...bridge,
    ...(systemPromptAppendix !== undefined ? { systemPromptAppendix } : {}),
  };
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

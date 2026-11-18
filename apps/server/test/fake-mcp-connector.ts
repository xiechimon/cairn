import type { McpConnectorStatus, McpConnectorTool } from '@cairn/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { mcpConnector } from '../src/db/schema.js';
import type { TestServer } from './helpers.js';

export function fakeMcp() {
  const calls: { name: string; args: unknown }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const server = new McpServer({ name: 'fake-connector', version: '1.0.0' });
    server.registerTool(
      'GMAIL_FETCH',
      {
        description: 'read mail',
        inputSchema: { max: z.number().optional() },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        calls.push({ name: 'GMAIL_FETCH', args });
        return { content: [{ type: 'text', text: 'inbox-ok' }] };
      },
    );
    server.registerTool(
      'GMAIL_SEND',
      { description: 'send mail', inputSchema: { to: z.string(), body: z.string().optional() } },
      async (args) => {
        calls.push({ name: 'GMAIL_SEND', args });
        return { content: [{ type: 'text', text: 'sent-ok' }] };
      },
    );
    server.registerTool(
      'GMAIL_DELETE',
      {
        description: 'delete mail',
        inputSchema: { id: z.string() },
        annotations: { destructiveHint: true },
      },
      async (args) => {
        calls.push({ name: 'GMAIL_DELETE', args });
        return { content: [{ type: 'text', text: 'deleted-ok' }] };
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export const FAKE_MCP_TOOLS: McpConnectorTool[] = [
  {
    name: 'GMAIL_FETCH',
    description: 'read mail',
    inputSchema: {
      type: 'object',
      properties: { max: { type: 'integer' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'GMAIL_SEND',
    description: 'send mail',
    inputSchema: {
      type: 'object',
      required: ['to'],
      properties: { to: { type: 'string' }, body: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'GMAIL_DELETE',
    description: 'delete mail',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
];

export function insertConnector(
  s: TestServer,
  opts: { slug?: string; status?: McpConnectorStatus; toolsJson?: McpConnectorTool[] } = {},
): string {
  const id = `conn-${Math.random().toString(36).slice(2, 10)}`;
  s.db
    .insert(mcpConnector)
    .values({
      id,
      teamId: s.team.id,
      slug: opts.slug ?? 'gmail',
      label: 'Gmail',
      url: 'https://mcp.test/s/sess-1',
      headerNames: [],
      authKind: 'composio',
      status: opts.status ?? 'connected',
      toolsJson: opts.toolsJson ?? FAKE_MCP_TOOLS,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return id;
}

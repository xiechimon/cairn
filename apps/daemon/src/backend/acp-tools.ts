import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { SessionOpts } from '@cairn/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DAEMON_VERSION } from '../version.js';

export async function openAcpTools(opts: SessionOpts) {
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
  const token = randomBytes(32).toString('hex');
  const active = new Set<Server>();
  const listener = createServer((req, res) => {
    const serve = async () => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end();
        return;
      }
      if (req.headers.origin !== undefined || req.url !== '/mcp') {
        res.writeHead(403).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += data.length;
        if (size > 1_048_576) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(data);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      const server = new Server(
        { name: 'cairn', version: DAEMON_VERSION },
        { capabilities: { tools: {} } },
      );
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
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
            isError: true,
          };
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      active.add(server);
      res.once('close', () => {
        active.delete(server);
        void server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    };
    void serve().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
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
    throw new Error('ACP host tool listener has no address');
  }
  return {
    declaration: {
      type: 'http' as const,
      name: 'cairn',
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    },
    close: () => {
      listener.close();
      listener.closeAllConnections();
      for (const server of active) void server.close().catch(() => {});
      active.clear();
    },
  };
}

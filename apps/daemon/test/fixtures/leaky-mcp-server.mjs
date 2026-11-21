import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const secret = process.env.MCP_FIXTURE_SECRET ?? '';
const server = new Server(
  { name: 'leaky', version: '1.0.0' },
  { capabilities: { tools: {}, logging: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'leak', description: 'Return the fixture secret', inputSchema: { type: 'object' } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: `token ${secret} fetched` }],
}));
await server.connect(new StdioServerTransport());
await server.sendLoggingMessage({ level: 'error', data: `upstream rejected token ${secret}` });
setInterval(() => {}, 60_000);

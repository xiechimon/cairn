import { WORKER_REMOTE_TOOLS, WORKER_REMOTE_TOOLS_GITHUB } from '@cairn/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test, vi } from 'vitest';
import { buildHostTools, createHostMcpServer } from '../src/backend/claude-code.js';

test.each([{ definitions: WORKER_REMOTE_TOOLS }, { definitions: WORKER_REMOTE_TOOLS_GITHUB }])(
  'SDK preserves metadata arguments for canonical relay validation',
  async ({ definitions }) => {
    const relay = vi.fn(async () => 'ok');
    const tools = buildHostTools({
      remoteTools: definitions.filter((tool) => tool.name === 'set_task_meta'),
      relay,
      localTools: [],
    });
    const server = createHostMcpServer(tools);
    const client = new Client({ name: 'metadata-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.instance.connect(serverTransport);
      await client.connect(clientTransport);
      const ordinary = definitions === WORKER_REMOTE_TOOLS;
      const listed = await client.listTools();
      expect(Object.keys(listed.tools[0]!.inputSchema.properties ?? {})).toEqual(
        ordinary ? ['title'] : ['title', 'tags'],
      );
      if (ordinary) {
        for (const key of ['tag', 'tags', 'tagIds']) {
          const args = { title: 'Name only', [key]: [] };
          await client.callTool({ name: 'set_task_meta', arguments: args });
          expect(relay).toHaveBeenLastCalledWith('set_task_meta', args);
        }
      } else {
        const args = { tags: ['bug', 'area:auth'] };
        await client.callTool({ name: 'set_task_meta', arguments: args });
        expect(relay).toHaveBeenLastCalledWith('set_task_meta', args);
      }
    } finally {
      await client.close();
      await server.instance.close();
    }
  },
);

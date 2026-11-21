import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

export interface StdioToolAnswer {
  text: string;
  isError: boolean;
}

export interface StdioToolClient {
  callTool(
    name: string,
    args: Record<string, unknown>,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<StdioToolAnswer>;
  close(): Promise<void>;
}

export async function openStdioToolClient(input: {
  command: string;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<StdioToolClient> {
  const transport = new StdioClientTransport({
    command: input.command,
    args: [...input.args],
    stderr: 'ignore',
  });
  const client = new Client({ name: 'cairn-computer', version: '0.1.0' });
  const deadline = AbortSignal.timeout(input.timeoutMs);
  try {
    await client.connect(transport, {
      timeout: input.timeoutMs,
      signal: input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]),
    });
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return {
    async callTool(name, args, options) {
      const result = await client.request(
        { method: 'tools/call', params: { name, arguments: args } },
        CallToolResultSchema,
        { timeout: options.timeoutMs, ...(options.signal ? { signal: options.signal } : {}) },
      );
      const text = result.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .filter((part) => part !== '')
        .join('\n')
        .trim();
      return { text, isError: result.isError === true };
    },
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { LANGFUSE_ATTR } from '@cairn/shared';
import { parseOtlpTarget, stepOtelContext } from '@cairn/shared/otel';
import { expect, test, vi } from 'vitest';
import { createPiBackend } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

interface CapturedSpan {
  name: string;
  traceId: string;
  parentSpanId: string;
  attributes: { key: string; value: { stringValue?: string } }[];
}

function messageText(message: { role: string; content: unknown }) {
  const content = message.content;
  return {
    role: message.role === 'toolResult' ? 'tool' : message.role,
    content:
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('')
          : '',
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test('worker generations export the actual requests and responses, including tool continuation', async () => {
  const spans: CapturedSpan[] = [];
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  const collector = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      resourceSpans: { scopeSpans: { spans: CapturedSpan[] }[] }[];
    };
    spans.push(...body.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
    response.end('{}');
  });
  const model = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const tool = requests.length === 1;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(
      `data: ${JSON.stringify({
        id: `request-${requests.length}`,
        object: 'chat.completion.chunk',
        model: 'payload-model',
        choices: [
          {
            index: 0,
            delta: tool
              ? {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'lookup', arguments: '{}' },
                    },
                  ],
                }
              : { role: 'assistant', content: 'The worker answer.' },
            finish_reason: tool ? 'tool_calls' : 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      })}\n\ndata: [DONE]\n\n`,
    );
    response.end();
  });
  const endpoint = await listen(collector);
  const baseUrl = await listen(model);
  const directory = testTempDir('pi-observation-payload-');
  const ctx = stepOtelContext(
    'payload-build',
    'payload-step',
    parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: endpoint })!,
  );
  const handle = await createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
  }).createSession({
    cwd: directory,
    provider: {
      kind: 'http',
      providerId: 'payload-provider',
      baseUrl: `${baseUrl}/v1`,
      api: 'openai-completions',
      models: [{ id: 'payload-model', name: 'Payload model' }],
    },
    modelId: 'payload-model',
    systemPrompt: 'Synthetic worker system instructions.',
    prompt: 'Look up the worker answer.',
    telemetry: ctx,
    remoteToolsOnly: true,
    remoteTools: [
      {
        name: 'lookup',
        description: 'Look up a result',
        parameters: { type: 'object', properties: {} },
      },
    ],
    executeRemoteTool: async () => 'The tool result.',
  });
  try {
    for await (const event of handle.events) {
      if (event.type === 'error') throw new Error(event.error.message);
    }
    await vi.waitFor(() => expect(spans.filter((s) => s.name.startsWith('chat '))).toHaveLength(2));
    expect(requests).toHaveLength(2);
    const chats = spans.filter((s) => s.name.startsWith('chat '));
    for (const [index, chat] of chats.entries()) {
      expect(chat.traceId).toBe(ctx.traceId);
      expect(chat.parentSpanId).toBe(ctx.stepSpanId);
      const attrs = Object.fromEntries(chat.attributes.map((a) => [a.key, a.value.stringValue]));
      const input = JSON.parse(attrs[LANGFUSE_ATTR.input]!) as { role: string; content: unknown }[];
      expect(input.filter((message) => message.role !== 'assistant').map(messageText)).toEqual(
        requests[index]!.messages.filter((message) => message.role !== 'assistant').map(
          messageText,
        ),
      );
      expect(input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.anything() }),
        ]),
      );
      expect(JSON.stringify(input)).toContain('Look up the worker answer.');
      expect(JSON.stringify(input)).toContain('Synthetic worker system instructions.');
      if (index === 1) expect(JSON.stringify(input)).toContain('The tool result.');
      const output = JSON.parse(attrs[LANGFUSE_ATTR.output]!);
      expect(output.role).toBe('assistant');
      expect(JSON.stringify(output)).toContain(index === 0 ? 'lookup' : 'The worker answer.');
    }
  } finally {
    await handle.stop();
    await close(model);
    await close(collector);
  }
});

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getSystemMessageText,
  type Message,
} from '@earendil-works/pi-ai';
import { afterEach, expect, test, vi } from 'vitest';
import { boot, world } from './runner-world.js';

interface Span {
  name: string;
  attributes: { key: string; value: { stringValue?: string } }[];
}

afterEach(() => vi.unstubAllEnvs());

test('SDK observations contain owner input, reply, and each actual generation request and response', async () => {
  const spans: Span[] = [];
  const collector = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      for (const resource of body.resourceSpans) {
        for (const scope of resource.scopeSpans) spans.push(...scope.spans);
      }
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  vi.stubEnv(
    'CAIRN_OTEL_ENDPOINT',
    `http://127.0.0.1:${(collector.address() as AddressInfo).port}/v1/traces`,
  );
  const requests: unknown[] = [];
  const w = await world('show my tasks');
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  faux.setResponses(
    Array(4).fill((context: { messages: Message[] }) => {
      requests.push(
        structuredClone(
          context.messages.map((message) => ({
            role: message.role,
            content: message.role === 'system' ? getSystemMessageText(message) : message.content,
          })),
        ),
      );
      return context.messages.at(-1)?.role === 'toolResult'
        ? fauxAssistantMessage('Here are your tasks.')
        : fauxAssistantMessage([fauxToolCall('todos', {})], { stopReason: 'toolUse' });
    }),
  );
  const coordinator = boot(w, faux);
  try {
    coordinator.wake(w.threadId);
    await coordinator.idle();
    await vi.waitFor(() =>
      expect(spans.some((span) => span.name === 'coordinator turn')).toBe(true),
    );
    const attr = (span: Span | undefined, key: string) =>
      span?.attributes.find((attribute) => attribute.key === key)?.value.stringValue;
    const root = spans.find((span) => span.name === 'coordinator turn');
    expect.soft(attr(root, 'langfuse.observation.input')).toContain('show my tasks');
    expect.soft(attr(root, 'langfuse.observation.output')).toContain('Here are your tasks.');
    const chats = spans.filter((span) => span.name === 'chat m');
    expect(chats).toHaveLength(3);
    for (let index = 0; index < chats.length; index++) {
      expect
        .soft(JSON.parse(attr(chats[index], 'langfuse.observation.input') ?? 'null'))
        .toEqual(requests[index]);
      expect.soft(attr(chats[index], 'langfuse.observation.output')).toBeTruthy();
    }
    expect.soft(attr(chats[1], 'langfuse.observation.output')).toContain('Here are your tasks.');
  } finally {
    await coordinator.close();
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});

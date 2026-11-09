import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { StepEvent } from '@cairn/shared';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { createPiBackend } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

function responseStream(text: string): string {
  const item = {
    type: 'message',
    id: 'msg_summary',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  return [
    { type: 'response.created', response: { id: 'resp_summary' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id: 'resp_summary',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      },
    },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

test('real worker session compacts a full context through Responses and finishes the next turn', async () => {
  const directory = testTempDir('pi-ceiling-session-');
  const sessionDir = join(directory, 'sessions');
  const manager = SessionManager.create(directory, sessionDir);
  for (const content of [
    `old transcript ${'x'.repeat(1_280_000)}`,
    `Keep working on the task. ${'y'.repeat(90_000)}`,
  ]) {
    manager.appendMessage({ role: 'user', content, timestamp: 1 });
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Ready to finish.' }],
      api: 'openai-responses',
      provider: 'synthetic-ceiling',
      model: 'ceiling',
      stopReason: 'stop',
      timestamp: 2,
      usage: {
        input: 319_863,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 319_873,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
  }
  const file = manager.getSessionFile();
  if (!file) throw new Error('Missing persisted session');
  expect(SessionManager.open(file).buildSessionContext().messages).toHaveLength(4);
  const summarySizes: number[] = [];
  const normalBodies: string[] = [];
  const logs: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as { input: unknown[]; max_output_tokens?: number };
    const summary = raw.includes('You are a context summarization assistant.');
    if (summary) {
      const size = JSON.stringify(body.input).length;
      summarySizes.push(size);
      if (size > 640_000) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'context_length_exceeded',
              message: `This model's maximum context length is 320000 tokens. However, you requested ${body.max_output_tokens ?? 16_384} output tokens and your prompt contains at least 320001 input tokens`,
            },
          }),
        );
        return;
      }
    } else {
      normalBodies.push(raw);
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      responseStream(
        summary ? '## Goal\nFinish the task after compaction.' : 'Task completed after recovery.',
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  const backend = createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir,
    resolveSessionFile: () => file,
    onCompactionLog: (line) => logs.push(line),
  });
  const handle = await backend.continueSession(manager.getSessionId(), {
    cwd: directory,
    systemPrompt: 'Finish the assigned task.',
    modelId: 'ceiling',
    prompt: 'Finish now.',
    provider: {
      kind: 'http',
      providerId: 'synthetic-ceiling',
      api: 'openai-responses',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: 'synthetic-test-key',
      models: [{ id: 'ceiling', name: 'Ceiling', contextWindow: 320_000, maxTokens: 16_384 }],
    },
  });
  const events: StepEvent[] = [];
  try {
    for await (const event of handle.events) events.push(event);
    expect(summarySizes.length).toBeGreaterThan(1);
    expect(summarySizes.length).toBeLessThanOrEqual(4);
    expect(summarySizes.at(-1)).toBeLessThan(640_000);
    expect(logs.join('\n')).toContain('dropped older conversation text');
    expect(logs.join('\n')).not.toContain('compaction failed');
    expect(events.filter((event) => event.type === 'error')).toEqual([]);
    expect(events.filter((event) => event.type === 'compaction_start')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'compaction_end')).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('done');
    expect(
      events.some((event) => event.type === 'text_delta' && event.text.includes('Task completed')),
    ).toBe(true);
    expect(normalBodies).toHaveLength(1);
    expect(normalBodies[0]).toContain('Finish the task after compaction.');
    expect(normalBodies[0]).not.toContain('x'.repeat(1_000));
    expect(readFileSync(file, 'utf8')).toContain('"type":"compaction"');
    console.info(
      JSON.stringify({
        summarySizes,
        logs,
        events: events.map((event) => event.type),
        resumedRequests: normalBodies.length,
      }),
    );
  } finally {
    await handle.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 20_000);

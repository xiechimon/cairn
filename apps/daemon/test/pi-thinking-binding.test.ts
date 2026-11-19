import { createServer } from 'node:http';
import { join } from 'node:path';
import type { StepEvent } from '@cairn/shared';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { createPiBackend } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

const BOUND_ERROR =
  'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.';

function anthropicStream(text: string): string {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

test('a resumed Claude task session recovers when Anthropic rejects thinking bound to an earlier prefix', async () => {
  const directory = testTempDir('pi-thinking-binding-');
  const sessionDir = join(directory, 'sessions');
  const manager = SessionManager.create(directory, sessionDir);
  manager.appendMessage({ role: 'user', content: 'Start the task.', timestamp: 1 });
  manager.appendMessage({
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', thinkingSignature: 'signed-under-the-old-system-prompt' },
      { type: 'text', text: 'Started.' },
    ],
    api: 'anthropic-messages',
    provider: 'synthetic-claude',
    model: 'claude-opus-5-5',
    stopReason: 'stop',
    timestamp: 2,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const file = manager.getSessionFile();
  if (!file) throw new Error('Missing persisted session');
  const statuses: number[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (raw.includes('signed-under-the-old-system-prompt')) {
      statuses.push(400);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: BOUND_ERROR },
        }),
      );
      return;
    }
    statuses.push(200);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(anthropicStream('Task completed.'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  const backend = createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir,
    resolveSessionFile: () => file,
  });
  const handle = await backend.continueSession(manager.getSessionId(), {
    cwd: directory,
    systemPrompt: 'Finish the assigned task.',
    modelId: 'claude-opus-5-5',
    prompt: 'Finish now.',
    provider: {
      kind: 'http',
      providerId: 'synthetic-claude',
      api: 'anthropic-messages',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'synthetic-test-key',
      models: [{ id: 'claude-opus-5-5', name: 'claude-opus-5-5' }],
    },
  });
  const events: StepEvent[] = [];
  try {
    for await (const event of handle.events) events.push(event);
    expect(statuses).toEqual([400, 200]);
    expect(events.filter((event) => event.type === 'error')).toEqual([]);
    expect(events.at(-1)?.type).toBe('done');
  } finally {
    await handle.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 20_000);

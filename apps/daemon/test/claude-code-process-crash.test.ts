import { type Query, query } from '@anthropic-ai/claude-agent-sdk';
import type { StepEvent } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn(),
}));

afterEach(() => {
  vi.mocked(query).mockReset();
});

test('a crashed claude process is reported as a process crash, not a model error', async () => {
  vi.mocked(query).mockImplementation(({ prompt }) => {
    if (typeof prompt !== 'string')
      void (async () => {
        for await (const _ of prompt) break;
      })();
    const messages = (async function* () {
      yield* [];
      throw new Error(
        'Claude Code process exited with code 1. stderr: var Ryt=["CLAUDE_BG_DISPATCHER_RATE_LIMIT_TIER"]',
      );
    })();
    return Object.assign(messages, { interrupt: vi.fn(async () => {}) }) as unknown as Query;
  });
  const handle = await createClaudeCodeBackend({}).createSession({
    provider: { kind: 'http', providerId: 'fake-claude' },
    modelId: 'fake-model',
    cwd: '/tmp',
    prompt: 'Begin the task.',
  });
  const events: StepEvent[] = [];
  for await (const event of handle.events) events.push(event);

  expect(events).toContainEqual({
    type: 'error',
    error: expect.objectContaining({ retryable: false, processCrash: true }),
  });
});

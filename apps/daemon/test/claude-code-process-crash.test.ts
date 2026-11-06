import { type Query, query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { StepEvent } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn(),
}));

afterEach(() => {
  vi.mocked(query).mockReset();
  vi.unstubAllEnvs();
});

test.each([true, false])(
  'authentication_failed identifies the credential and keeps the CLI reason without leaking a token (step token=%s)',
  async (teamSubscriptionToken) => {
    const token = 'synthetic-team-subscription-token-do-not-display';
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', token);
    vi.mocked(query).mockImplementation(() => {
      const messages = (async function* () {
        yield {
          type: 'assistant',
          error: 'authentication_failed',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Failed to authenticate: OAuth token revoked' }],
          },
        } as unknown as SDKMessage;
        yield {
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Failed to authenticate: OAuth token revoked (timeout)',
        } as unknown as SDKMessage;
      })();
      return Object.assign(messages, { interrupt: vi.fn(async () => {}) }) as unknown as Query;
    });
    const handle = await createClaudeCodeBackend({
      machineName: 'daemon-test',
      inOrb: true,
    }).createSession({
      provider: { kind: 'http', providerId: 'fake-claude' },
      modelId: 'fake-model',
      cwd: '/tmp',
      ...(teamSubscriptionToken ? { env: { CLAUDE_CODE_OAUTH_TOKEN: token } } : {}),
    });
    const events: StepEvent[] = [];
    for await (const event of handle.events) events.push(event);
    const failure = events.find((event) => event.type === 'error');
    expect(failure).toBeDefined();
    if (failure?.type !== 'error') throw new Error('Expected an authentication error');
    expect(failure.error.message).toContain(
      'Failed to authenticate: OAuth token revoked (timeout)',
    );
    expect(failure.error.message).not.toContain(token);
    expect(failure.error.retryable).toBe(false);
    if (teamSubscriptionToken) {
      expect(failure.error.message).toContain('团队 Claude 订阅');
      expect(failure.error.message).toContain('设置 → 订阅');
      expect(failure.error.message).toContain('claude setup-token');
      expect(failure.error.message).toContain('验证');
      expect(failure.error.message).not.toContain('claude auth status');
    } else {
      expect(failure.error.message).toContain('daemon-test');
      expect(failure.error.message).toContain('claude auth status');
      expect(failure.error.message).toContain('/login');
      expect(failure.error.message).not.toContain('团队 Claude 订阅');
    }
  },
);

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

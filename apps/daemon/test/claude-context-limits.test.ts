import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Query, query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ModelUsage, StepEvent } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  createClaudeCodeBackend,
  createClaudeMapState,
  mapClaudeMessage,
  sdkTranscriptPath,
} from '../src/backend/claude-code.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn(),
}));

const MODEL = 'claude-sonnet-5-5';

const assistant = (model: string, usage: Record<string, number>, parent: string | null = null) =>
  ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { id: `msg-${model}`, role: 'assistant', model, content: [], usage },
  }) as unknown as SDKMessage;

const result = (windows: Record<string, number>) =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    session_id: 'sess-1',
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: Object.fromEntries(
      Object.entries(windows).map(([model, contextWindow]) => [
        model,
        {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0,
          webSearchRequests: 0,
          contextWindow,
          maxOutputTokens: 64_000,
        },
      ]),
    ),
  }) as unknown as SDKMessage;

function doneRows(events: StepEvent[]): ModelUsage[] {
  const done = events.find((e) => e.type === 'done');
  if (done?.type !== 'done') throw new Error('expected a done event');
  return [...done.usage];
}

describe('mapClaudeMessage context limits on the context-bearing row', () => {
  const feed = (limits: ReturnType<typeof createClaudeMapState>['contextLimits'] | undefined) => {
    const state = createClaudeMapState();
    if (limits !== undefined) state.contextLimits = limits;
    const events = [
      assistant('claude-haiku-5-5', { input_tokens: 500 }, 'toolu_task'),
      assistant(MODEL, { input_tokens: 40_000, output_tokens: 300 }),
      result({ [MODEL]: 1_000_000, 'claude-haiku-5-5': 200_000 }),
    ].flatMap((msg) => mapClaudeMessage(msg, state));
    const rows = doneRows(events);
    return {
      main: rows.find((row) => row.model === `claude-code/${MODEL}`),
      sub: rows.find((row) => row.model === 'claude-code/claude-haiku-5-5'),
    };
  };

  test('measured limits for the context model ride on its row only', () => {
    const { main, sub } = feed({ model: MODEL, window: 200_000, compactAt: 167_000 });
    expect(main).toMatchObject({
      contextTokens: 40_300,
      contextWindow: 200_000,
      compactAt: 167_000,
    });
    expect(sub).not.toHaveProperty('contextWindow');
    expect(sub).not.toHaveProperty('compactAt');
  });

  test('limits measured for another model fall back to the reported window with no threshold', () => {
    const { main } = feed({ model: 'claude-opus-5-5', window: 200_000, compactAt: 167_000 });
    expect(main).toMatchObject({ contextTokens: 40_300, contextWindow: 1_000_000 });
    expect(main).not.toHaveProperty('compactAt');
  });

  test('no measured limits fall back to the reported window with no threshold', () => {
    const { main } = feed(undefined);
    expect(main).toMatchObject({ contextWindow: 1_000_000 });
    expect(main).not.toHaveProperty('compactAt');
  });

  test('auto-compact off measures the window and reports no threshold', () => {
    const { main } = feed({ model: MODEL, window: 200_000 });
    expect(main).toMatchObject({ contextWindow: 200_000 });
    expect(main).not.toHaveProperty('compactAt');
  });
});

type Reply = 'before-result' | 'after-result' | 'never' | 'rejected';

describe('the session asks Claude Code for its limits without waiting on the answer', () => {
  let configDir = '';
  let cwd = '';

  beforeEach(() => {
    configDir = makeTestTempDir('cc-limits-config-');
    cwd = makeTestTempDir('cc-limits-cwd-');
    vi.stubEnv('CLAUDE_CONFIG_DIR', configDir);
  });

  afterEach(() => {
    vi.mocked(query).mockReset();
    vi.unstubAllEnvs();
    releaseTestTempDir(configDir);
    releaseTestTempDir(cwd);
  });

  async function runTurn(reply: Reply, resumed: boolean) {
    const contextUsage = {
      model: MODEL,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
    };
    let answer: (value: typeof contextUsage) => void = () => {};
    const getContextUsage = vi.fn(() => {
      if (reply === 'rejected') return Promise.reject(new Error('control request failed'));
      if (reply === 'before-result') return Promise.resolve(contextUsage);
      return new Promise<typeof contextUsage>((resolve) => {
        answer = resolve;
      });
    });
    vi.mocked(query).mockImplementation(({ prompt }) => {
      if (typeof prompt !== 'string')
        void (async () => {
          for await (const _ of prompt) break;
        })();
      const messages = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1' } as SDKMessage;
        await Promise.resolve();
        yield assistant(MODEL, { input_tokens: 40_000, output_tokens: 300 });
        yield result({ [MODEL]: 1_000_000 });
        if (reply === 'after-result') answer(contextUsage);
      })();
      return Object.assign(messages, {
        interrupt: vi.fn(async () => {}),
        getContextUsage,
      }) as unknown as Query;
    });
    const backend = createClaudeCodeBackend({});
    const opts = {
      provider: { kind: 'http' as const, providerId: 'fake-claude' },
      modelId: MODEL,
      cwd,
    };
    let handle: Awaited<ReturnType<typeof backend.createSession>>;
    if (resumed) {
      const transcript = sdkTranscriptPath(cwd, 'sess-1');
      mkdirSync(dirname(transcript), { recursive: true });
      writeFileSync(transcript, '{}\n');
      handle = await backend.continueSession('sess-1', opts);
    } else {
      handle = await backend.createSession(opts);
    }
    const events: StepEvent[] = [];
    for await (const event of handle.events) events.push(event);
    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls[0]?.[0].options).toMatchObject(
      resumed ? { resume: 'sess-1' } : { sessionId: expect.any(String) },
    );
    return doneRows(events).find((row) => row.model === `claude-code/${MODEL}`);
  }

  for (const resumed of [false, true]) {
    const kind = resumed ? 'resumed' : 'new';
    test(`${kind} session: a reply before the result puts the measured limits on the row`, async () => {
      expect(await runTurn('before-result', resumed)).toMatchObject({
        contextTokens: 40_300,
        contextWindow: 200_000,
        compactAt: 167_000,
      });
    });

    test.each<Reply>(['after-result', 'never', 'rejected'])(
      `${kind} session: a reply %s still finishes the turn with the reported window and no threshold`,
      async (reply) => {
        const row = await runTurn(reply, resumed);
        expect(row).toMatchObject({ contextTokens: 40_300, contextWindow: 1_000_000 });
        expect(row).not.toHaveProperty('compactAt');
      },
    );
  }
});

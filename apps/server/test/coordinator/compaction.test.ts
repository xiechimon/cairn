import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COORDINATOR_SUMMARY_PROMPT_HEAD } from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Message,
} from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compactionWindow,
  coordinatorCompactionExtension,
  coordinatorCompactionSettings,
  foldSummary,
  splitPreviousSummary,
  summaryBatches,
  transcriptLines,
} from '../../src/coordinator/runtime/compaction.js';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { coordinatorToolsExtension, createStepGate } from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 1 });

describe('compaction policy', () => {
  it('starts background folds at 150k and leaves blocking at the edge of the window', () => {
    expect(compactionWindow(1_000_000)).toEqual({ blockingAt: 983_616, backgroundAt: 150_000 });
    expect(compactionWindow(200_000)).toEqual({ blockingAt: 183_616, backgroundAt: 91_808 });
    expect(compactionWindow(32_000)).toEqual({ blockingAt: 15_616, backgroundAt: 7_808 });
    const settings = coordinatorCompactionSettings([
      { provider: 'anthropic', id: 'claude-haiku-5-5', contextWindow: 1_000_000 },
    ]);
    expect(settings.modelOverrides?.['anthropic/claude-haiku-5-5']).toEqual({
      backgroundTokens: 983_616 - 150_000,
    });
  });
});

describe('C2 summary through beforeCompact', () => {
  it('renders the transcript like C2: user and Coordinator lines, tool calls without results', () => {
    const lines = transcriptLines([
      user('ship #72'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'dispatching' },
          { type: 'toolCall', id: 't1', name: 'run_builds', arguments: { todoIds: ['a'] } },
        ],
        api: 'stub',
        provider: 'stub',
        model: 'm',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: 1,
      },
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'run_builds',
        content: [{ type: 'text', text: 'SECRET RESULT BODY' }],
        isError: false,
        timestamp: 1,
      },
    ]);
    expect(lines).toEqual([
      '用户：ship #72',
      '总管：dispatching',
      '总管调用工具 run_builds {"todoIds":["a"]}',
    ]);
  });

  it('reads the earlier summary out of the head marker', () => {
    const { previous, rest } = splitPreviousSummary([
      user(
        'The conversation history before this point was compacted into the following summary:\n\n<summary>\nD56: keep the step claim\n</summary>',
      ),
      user('next'),
    ]);
    expect(previous).toBe('D56: keep the step claim');
    expect(rest).toHaveLength(1);
  });

  it('batches under 40k characters and folds each batch into the earlier summary', async () => {
    const lines = Array.from(
      { length: 30 },
      (_, i) => `用户：${String(i).padStart(2, '0')} ${'字'.repeat(3000)}`,
    );
    const batches = summaryBatches(lines);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(40_000);
    expect(batches.join('\n').split('\n')).toEqual(lines);

    const prompts: string[] = [];
    const summary = await foldSummary('earlier', batches, async (prompt) => {
      prompts.push(prompt);
      return `summary ${prompts.length}`;
    });
    expect(summary).toBe(`summary ${batches.length}`);
    expect(prompts[0]).toContain(COORDINATOR_SUMMARY_PROMPT_HEAD);
    expect(prompts[0]).toContain("Keep ian's verdicts");
    expect(prompts[0]).toContain('Earlier summary:\nearlier');
    expect(prompts[1]).toContain('Earlier summary:\nsummary 1');
  });
});

describe('a normal-sized Coordinator thread', () => {
  it('folds in the background and never makes a turn wait on compaction', async () => {
    const window = 80_000;
    const { blockingAt } = compactionWindow(window);
    const requestTokens: number[] = [];
    const summaryPrompts: string[] = [];
    const faux = fauxProvider({
      provider: 'stub',
      models: [
        { id: 'm', contextWindow: window },
        { id: 'sum', contextWindow: window },
      ],
    });
    faux.setResponses(
      Array(400).fill(
        (
          c: { systemPrompt?: string; messages: { role: string; content: unknown }[] },
          _o: unknown,
          _s: unknown,
          model: { id: string },
        ) => {
          if (model.id === 'sum') {
            summaryPrompts.push(JSON.stringify(c.messages));
            return fauxAssistantMessage('folded summary');
          }
          requestTokens.push(Math.ceil(JSON.stringify(c.messages).length / 4));
          const last = c.messages.at(-1);
          if (last?.role === 'toolResult')
            return fauxAssistantMessage(`answer ${'word '.repeat(1500)}`);
          return fauxAssistantMessage([fauxToolCall('todos', {})], { stopReason: 'toolUse' });
        },
      ),
    );
    const coordinatorModels = createCoordinatorModels([faux.provider]);
    const dir = mkdtempSync(join(tmpdir(), 'coord-compact-'));
    dirs.push(dir);
    const api = fakeMachineApi();
    api.relayTool = async () => 'row '.repeat(6000);
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(
      join(dir, 'c.sqlite'),
      coordinatorModels.models,
      ctx,
      {
        extensions: [
          coordinatorToolsExtension(api, gate),
          coordinatorCompactionExtension(() => ({ provider: 'stub', modelId: 'sum' })),
        ],
        settings: () => ({
          compaction: coordinatorCompactionSettings([
            { provider: 'stub', id: 'm', contextWindow: window },
          ]),
        }),
      },
    );
    for (let turn = 0; turn < 40; turn++) {
      await runCoordinatorTurn(
        {
          harness,
          models: coordinatorModels,
          api,
          context: ctx,
          heartbeatMs: 10_000,
          now: () => turn,
          gate,
        },
        chiefStep(`step-${turn}`, `turn ${turn}`),
      );
    }
    await harness.waitForIdle(ctx);
    expect(api.dones.every((d) => d.body.status === 'success')).toBe(true);
    expect(summaryPrompts.length).toBeGreaterThan(0);
    expect(summaryPrompts[0]).toContain('rolling summary of one Coordinator conversation');
    expect(Math.max(...requestTokens)).toBeLessThan(blockingAt);
    await harness.close(ctx);
  }, 60_000);
});

describe('summary input keeps events and tool results out', () => {
  it('writes a wake event as a short line with a pointer and drops tool results', () => {
    const lines = transcriptLines([
      user(
        `[wake:settle] provenance=watch:t1\n${'report line '.repeat(4_000)}\n\n[history id: step-7]`,
      ),
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'c1', name: 'todos', arguments: { q: 1 } }],
        api: 'x',
        provider: 'p',
        model: 'm',
        usage: {} as never,
        stopReason: 'toolUse',
        timestamp: 2,
      },
      {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'todos',
        content: [{ type: 'text', text: 'TOOL-RESULT-SECRET '.repeat(1_000) }],
        isError: false,
        timestamp: 3,
      },
    ]);
    const joined = lines.join('\n');
    expect(lines[0]?.startsWith('事件：[event settle]')).toBe(true);
    expect(lines[0]?.length).toBeLessThan(600);
    expect(lines[0]).toContain('read_history ids ["step-7"]');
    expect(joined).not.toContain('TOOL-RESULT-SECRET');
  });

  it('still writes a real user message in full', () => {
    expect(transcriptLines([user('ship #12 on Friday')])).toEqual(['用户：ship #12 on Friday']);
  });
});

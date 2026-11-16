import {
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { StepEvent } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn(),
}));

afterEach(() => {
  vi.mocked(query).mockReset();
  vi.useRealTimers();
});

interface Cli {
  nextPrompt(): Promise<string>;
  emit(message: object): void;
}

function fakeCli(script: (cli: Cli) => Promise<void>): string[] {
  const prompts: string[] = [];
  vi.mocked(query).mockImplementation(({ prompt }) => {
    const input = (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]();
    const out: SDKMessage[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const cli: Cli = {
      async nextPrompt() {
        const next = await input.next();
        if (next.done === true) {
          ended = true;
          wake?.();
          return new Promise<string>(() => {});
        }
        const content = next.value.message.content;
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        prompts.push(text);
        return text;
      },
      emit(message) {
        out.push(message as SDKMessage);
        wake?.();
      },
    };
    void script(cli).finally(() => {
      ended = true;
      wake?.();
    });
    const messages = (async function* () {
      for (;;) {
        const message = out.shift();
        if (message !== undefined) {
          yield message;
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    })();
    return Object.assign(messages, { interrupt: vi.fn(async () => {}) }) as unknown as Query;
  });
  return prompts;
}

const assistant = (text: string) => ({
  type: 'assistant',
  session_id: 's1',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const result = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'ok',
  session_id: 's1',
};
const started = (taskId: string, taskType: string, description: string) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: taskId,
  task_type: taskType,
  is_backgrounded: true,
  description,
  session_id: 's1',
});
const live = (...tasks: [string, string][]) => ({
  type: 'system',
  subtype: 'background_tasks_changed',
  tasks: tasks.map(([task_id, task_type]) => ({ task_id, task_type, description: task_id })),
  session_id: 's1',
});
const notified = (taskId: string, summary: string) => ({
  type: 'system',
  subtype: 'task_notification',
  task_id: taskId,
  status: 'completed',
  output_file: `/tmp/${taskId}.out`,
  summary,
  session_id: 's1',
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run(): Promise<StepEvent[]> {
  const handle = await createClaudeCodeBackend({}).createSession({
    provider: { kind: 'http', providerId: 'fake-claude' },
    modelId: 'fake-model',
    cwd: '/tmp',
    prompt: 'Summarize docs/ops and write the report.',
  });
  const events: StepEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

const waitCalls = (events: StepEvent[]) =>
  events.flatMap((event) =>
    event.type === 'toolcall_end' && event.call.name === 'await_background_subagents'
      ? [event.call]
      : [],
  );

test('a turn that ends while a background subagent runs waits for it and continues to the report', async () => {
  const prompts = fakeCli(async (cli) => {
    await cli.nextPrompt();
    cli.emit(started('agent-1', 'local_agent', 'Survey ops docs and scripts'));
    cli.emit(started('bash-1', 'local_bash', 'dev server'));
    cli.emit(live(['agent-1', 'local_agent'], ['bash-1', 'local_bash']));
    cli.emit(assistant('Waiting for the survey, then I will write the report.'));
    cli.emit(result);
    await tick();
    cli.emit({ ...assistant('subagent reading files'), parent_tool_use_id: 'toolu_agent' });
    cli.emit(live(['bash-1', 'local_bash']));
    await tick();
    cli.emit(notified('agent-1', 'found 12 scripts'));
    await cli.nextPrompt();
    cli.emit(assistant('Report written.'));
    cli.emit(result);
  });

  const events = await run();

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain('Survey ops docs and scripts');
  expect(prompts[1]).toContain('/tmp/agent-1.out');
  expect(prompts[1]).toContain('found 12 scripts');
  expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('done');
  const waits = waitCalls(events);
  expect(waits.map((call) => call.result === undefined)).toEqual([true, false]);
  expect(events.some((event) => event.type === 'steer' && event.text === prompts[1])).toBe(true);
});

test('a level that empties before the result arrives still waits for the notification', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const prompts = fakeCli(async (cli) => {
    await cli.nextPrompt();
    cli.emit(started('agent-1', 'local_agent', 'survey'));
    cli.emit(live(['agent-1', 'local_agent']));
    cli.emit(live());
    cli.emit(assistant('Waiting.'));
    cli.emit(result);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    cli.emit(live(['agent-1', 'local_agent']));
    cli.emit(live());
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    cli.emit(notified('agent-1', 'late result'));
    await cli.nextPrompt();
    cli.emit(assistant('Report written.'));
    cli.emit(result);
  });

  const pending = run();
  await vi.advanceTimersByTimeAsync(130_000);
  const events = await pending;

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain('late result');
  expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
});

test('continuations stop at the cap and the session finishes with a subagent still running', async () => {
  const prompts = fakeCli(async (cli) => {
    for (let turn = 1; ; turn++) {
      await cli.nextPrompt();
      cli.emit(started(`agent-${turn}`, 'local_agent', `survey ${turn}`));
      cli.emit(assistant(`turn ${turn}`));
      cli.emit(result);
      await tick();
      cli.emit(notified(`agent-${turn}`, `summary ${turn}`));
    }
  });

  const events = await run();

  expect(prompts).toHaveLength(4);
  expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('done');
});

test('an error while waiting ends the session with that error and no held success', async () => {
  const prompts = fakeCli(async (cli) => {
    await cli.nextPrompt();
    cli.emit(started('agent-1', 'local_agent', 'survey'));
    cli.emit(assistant('Waiting.'));
    cli.emit(result);
    await tick();
    cli.emit({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['reached max turns'],
      session_id: 's1',
    });
  });

  const events = await run();

  expect(prompts).toHaveLength(1);
  const terminal = events.filter((event) => ['done', 'error', 'message_stop'].includes(event.type));
  expect(terminal.map((event) => event.type)).toEqual(['error']);
});

test('a subagent that never finishes releases the turn after the wait limit', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const prompts = fakeCli(async (cli) => {
    await cli.nextPrompt();
    cli.emit(started('agent-1', 'local_agent', 'stuck survey'));
    cli.emit(assistant('Waiting.'));
    cli.emit(result);
    await new Promise(() => {});
  });

  const pending = run();
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  const events = await pending;

  expect(prompts).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('done');
  const waits = waitCalls(events);
  expect(waits).toHaveLength(2);
  expect(String(waits[1]?.result)).toContain('stuck survey');
});

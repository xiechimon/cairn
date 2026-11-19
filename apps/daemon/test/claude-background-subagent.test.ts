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
    return Object.assign(messages, {
      interrupt: vi.fn(async () => {}),
      stopTask: vi.fn(async () => {}),
    }) as unknown as Query;
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
  expect(waits.map((call) => call.result === undefined)).toEqual([true, false, true, false]);
  expect(waits[1]?.result).toContain('Survey ops docs and scripts');
  expect(waits[3]?.result).toContain('ended before the background');
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

test.each([false, true])(
  'a turn after the input closed is not held for its subagent (notification=%s)',
  async (notify) => {
    const prompts = fakeCli(async (cli) => {
      await cli.nextPrompt();
      cli.emit(assistant('First answer.'));
      cli.emit(result);
      await tick();
      cli.emit(started('agent-1', 'local_agent', 'late survey'));
      cli.emit(assistant('Waiting.'));
      cli.emit(result);
      await tick();
      if (notify) cli.emit(notified('agent-1', 'late result'));
      await tick();
    });

    const events = await run();

    expect(prompts).toHaveLength(1);
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(events.some((event) => event.type === 'steer')).toBe(false);
  },
);

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
  await vi.advanceTimersByTimeAsync(20 * 60_000 + 13_000);
  const events = await pending;

  expect(prompts).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('done');
  const waits = waitCalls(events);
  expect(waits).toHaveLength(2);
  expect(String(waits[1]?.result)).toContain('stuck survey');
});

test('background rows are reported as they change, and a shell still running when the step ends is orphaned before done', async () => {
  fakeCli(async (cli) => {
    await cli.nextPrompt();
    cli.emit({ ...started('bash-1', 'local_bash', 'npm run dev'), tool_use_id: 'toolu_bash' });
    cli.emit({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'bash-1',
      usage: { total_tokens: 0, tool_uses: 0, duration_ms: 5 },
      session_id: 's1',
    });
    cli.emit(assistant('Dev server is up.'));
    cli.emit(result);
  });
  const events = await run();
  const rows = events.flatMap((event, index) =>
    event.type === 'bg_task'
      ? [{ index, status: event.task.status, call: event.task.toolCallId }]
      : [],
  );
  const done = events.findIndex((event) => event.type === 'done');
  expect(rows.map((row) => row.status)).toEqual(['running', 'running', 'orphaned']);
  expect(rows.every((row) => row.call === 'toolu_bash')).toBe(true);
  expect(rows[2]?.index).toBeLessThan(done);
});

test('stopping one background task asks the CLI to stop that task; stopping the run marks the rest stopped', async () => {
  fakeCli(async (cli) => {
    await cli.nextPrompt();
    cli.emit(started('agent-1', 'local_agent', 'Survey ops docs'));
    await new Promise(() => {});
  });
  const handle = await createClaudeCodeBackend({
    settleTimeouts: { exitGraceMs: 50, killGraceMs: 50 },
  }).createSession({
    provider: { kind: 'http', providerId: 'fake-claude' },
    modelId: 'fake-model',
    cwd: '/tmp',
    prompt: 'Survey.',
  });
  const events: StepEvent[] = [];
  const drained = (async () => {
    for await (const event of handle.events) events.push(event);
  })();
  await vi.waitFor(() => expect(events.some((event) => event.type === 'bg_task')).toBe(true));
  await handle.stopTask?.('agent-1');
  const q = vi.mocked(query).mock.results[0]?.value as Query;
  expect(q.stopTask).toHaveBeenCalledWith('agent-1');
  await handle.stop();
  await drained;
  expect(events.flatMap((event) => (event.type === 'bg_task' ? [event.task.status] : []))).toEqual([
    'running',
    'stopped',
  ]);
});

test('a turn that ends while a background shell runs keeps the session open, so the shell can still be stopped', async () => {
  const stopTask = () => (vi.mocked(query).mock.results[0]?.value as Query | undefined)?.stopTask;
  const prompts = fakeCli(async (cli) => {
    await cli.nextPrompt();
    cli.emit({ ...started('bash-1', 'local_bash', 'sleep 120'), tool_use_id: 'toolu_bash' });
    cli.emit(assistant('Waiting for the shell.'));
    cli.emit(result);
    await vi.waitFor(() => expect(stopTask()).toHaveBeenCalledWith('bash-1'));
    cli.emit({ ...notified('bash-1', 'killed'), status: 'killed' });
    await cli.nextPrompt();
    cli.emit(assistant('The shell was stopped.'));
    cli.emit(result);
  });
  const handle = await createClaudeCodeBackend({}).createSession({
    provider: { kind: 'http', providerId: 'fake-claude' },
    modelId: 'fake-model',
    cwd: '/tmp',
    prompt: 'Run the dev server.',
  });
  const events: StepEvent[] = [];
  const drained = (async () => {
    for await (const event of handle.events) events.push(event);
  })();
  await vi.waitFor(() => expect(waitCalls(events)).toHaveLength(1));
  expect(events.some((event) => event.type === 'done')).toBe(false);
  await handle.stopTask?.('bash-1');
  await drained;
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain('sleep 120');
  expect(prompts[1]).toContain('stopped');
  expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('done');
  expect(events.flatMap((event) => (event.type === 'bg_task' ? [event.task.status] : []))).toEqual([
    'running',
    'stopped',
  ]);
});

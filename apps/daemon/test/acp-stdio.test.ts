import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { type SessionOpts, type StepEvent, stepEventSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { createGeminiBackend } from '../src/backend/acp.js';

const opts: SessionOpts = {
  provider: { kind: 'api_key', providerId: 'gemini' },
  cwd: process.cwd(),
  modelId: 'gemini',
  prompt: 'new turn',
};

async function collect(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const result: StepEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function backend(env: Record<string, string> = {}) {
  return createGeminiBackend({
    spawnProcess: () => {
      const child = new ChildProcess();
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const processHandle = Object.assign(child, {
        stdin,
        stdout,
        stderr,
        kill: () => {
          stdout.end();
          return true;
        },
      });
      const send = (value: object) =>
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
      const update = (value: object) =>
        send({ method: 'session/update', params: { sessionId: 'session-1', update: value } });
      let pending: unknown;
      let configured = false;
      stdin.on('data', (data: Buffer) => {
        const { id, method, params } = JSON.parse(data.toString());
        if (method === 'initialize')
          send({
            id,
            result: {
              protocolVersion: env.ACP_VERSION ? 99 : params.protocolVersion,
              agentCapabilities: {
                loadSession: env.ACP_RESUME !== 'resume',
                sessionCapabilities: env.ACP_RESUME === 'resume' ? { resume: {} } : {},
                promptCapabilities: { image: env.ACP_IMAGE === 'yes' },
              },
              authMethods: [],
            },
          });
        else if (['session/new', 'session/load', 'session/resume'].includes(method)) {
          if (
            (method === 'session/load' && env.ACP_RESUME === 'resume') ||
            (method === 'session/resume' && env.ACP_RESUME !== 'resume')
          ) {
            send({ id, error: { code: -32601, message: 'Session method was not advertised' } });
            return;
          }
          if (method === 'session/load')
            update({
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'old history' },
            });
          send({
            id,
            result: {
              sessionId: 'session-1',
              ...(env.ACP_CONFIG
                ? {
                    configOptions: [
                      {
                        id: 'model',
                        name: 'Model',
                        category: 'model',
                        type: 'select',
                        currentValue: 'other',
                        options: [{ value: 'gemini', name: 'Gemini' }],
                      },
                    ],
                  }
                : {}),
            },
          });
        } else if (method === 'session/set_config_option') {
          configured = params.configId === 'model' && params.value === 'gemini';
          send({ id, result: { configOptions: [] } });
        } else if (method === 'session/prompt') {
          if (
            env.ACP_IMAGE === 'yes' &&
            !params.prompt.some((block: { type: string }) => block.type === 'image')
          ) {
            send({ id, error: { code: -32602, message: 'Image prompt was dropped' } });
            return;
          }
          if (env.ACP_CONFIG && !configured) {
            send({ id, error: { code: -32603, message: 'Model was not configured' } });
            return;
          }
          if (params.prompt[0].text === 'cancel') {
            pending = id;
            return;
          }
          update({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: params.prompt[0].text },
          });
          update({
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Read file',
            kind: 'read',
            rawInput: { path: 'README.md' },
            status: 'pending',
          });
          update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tool-1',
            status: 'completed',
            content: [{ type: 'content', content: { type: 'text', text: 'file content' } }],
          });
          send({ id, result: { stopReason: env.ACP_STOP ?? 'end_turn' } });
        } else if (method === 'session/cancel')
          send({
            id: pending,
            error: { code: -32603, message: 'ordinary failure after cancellation' },
          });
      });
      return processHandle;
    },
  });
}

describe('Gemini stdio execution', () => {
  test('records complete text and merged tool results with empty usage', async () => {
    const handle = await backend().createSession(opts);
    const events = await collect(handle.events);
    expect(handle.sessionId).toBe('session-1');
    for (const event of events) expect(stepEventSchema.safeParse(event).success).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_end' }));
    expect(events).toContainEqual({ type: 'done', usage: [] });
    expect(events).toContainEqual({
      type: 'toolcall_end',
      call: expect.objectContaining({
        id: 'tool-1',
        name: 'Read file',
        arguments: { path: 'README.md' },
        isError: false,
        result: expect.any(Array),
      }),
    });
  });

  test.each(['load', 'resume'])(
    'continues through advertised %s without replaying history',
    async (resume) => {
      const handle = await backend({ ACP_RESUME: resume }).continueSession('session-1', opts);
      const events = await collect(handle.events);
      expect(events.filter((event) => event.type === 'text_delta')).toEqual([
        { type: 'text_delta', text: 'new turn' },
      ]);
      expect(events.filter((event) => event.type === 'message_end')).toHaveLength(1);
    },
  );

  test.each(['max_tokens', 'max_turn_requests', 'refusal'])('fails on %s', async (reason) => {
    const handle = await backend({ ACP_STOP: reason }).createSession(opts);
    expect(await collect(handle.events)).toContainEqual({
      type: 'error',
      error: { message: `Gemini ACP stopped: ${reason}`, retryable: false },
    });
  });

  test('accepts images only when advertised', async () => {
    const images = { ...opts, promptImages: [{ data: 'aA==', mimeType: 'image/png' }] };
    await expect(backend().createSession(images)).rejects.toThrow('image capability');
    const handle = await backend({ ACP_IMAGE: 'yes' }).createSession(images);
    expect(await collect(handle.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test('applies the advertised model configuration before prompting', async () => {
    const handle = await backend({ ACP_CONFIG: 'yes' }).createSession(opts);
    expect(await collect(handle.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test('reports both negotiated protocol versions', async () => {
    await expect(backend({ ACP_VERSION: 'bad' }).createSession(opts)).rejects.toThrow(
      /client=1, agent=99/,
    );
  });

  test('cancellation converts an ordinary prompt error into a valid stop event', async () => {
    const handle = await backend().createSession({ ...opts, prompt: 'cancel' });
    const events = collect(handle.events);
    await handle.stop();
    const result = await events;
    expect(result.some((event) => event.type === 'message_stop')).toBe(true);
    expect(result.some((event) => event.type === 'error')).toBe(false);
    for (const event of result) expect(stepEventSchema.safeParse(event).success).toBe(true);
  });
});

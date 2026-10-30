import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { type SessionOpts, type StepEvent, toolCallRecordSchema } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { configuredAcpBackends, createAcpBackend } from '../src/backend/acp.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
const opts: SessionOpts = {
  cwd: process.cwd(),
  provider: { kind: 'api_key', providerId: 'openai' },
  modelId: 'stub-model',
  prompt: 'Hello',
};

function adapter(scenario = 'complete') {
  return createAcpBackend({
    harness: 'codex',
    command: process.execPath,
    args: [fixture, scenario],
    initializeTimeoutMs: scenario === 'hang-init' ? 300 : 3_000,
    cancelTimeoutMs: 100,
  });
}

async function collect(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const result: StepEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

afterEach(() => vi.unstubAllEnvs());

describe('ACP spike with a real scripted stdio child', () => {
  test.each(['claude-code', 'codex'] as const)(
    '%s lands the same step transcript, tools and status as the existing backend',
    async (harness) => {
      const events: StepEvent[] = [
        { type: 'thinking_delta', text: 'Thinking' },
        { type: 'text_delta', text: 'Hello ' },
        { type: 'text_delta', text: 'Thread' },
        {
          type: 'toolcall_end',
          call: { id: 'read-1', name: 'Read', arguments: { path: 'README.md' } },
        },
        {
          type: 'toolcall_end',
          call: {
            id: 'read-1',
            name: 'Read',
            arguments: { path: 'README.md' },
            result: 'file content',
            isError: false,
          },
        },
        { type: 'message_end', message: { role: 'assistant', content: 'Hello Thread' } },
        { type: 'done', usage: [] },
      ];
      const run = async (acp: boolean) => {
        vi.stubEnv(
          'CAIRN_ACP_AGENTS',
          acp
            ? JSON.stringify({ a1: { harness, command: process.execPath, args: [fixture] } })
            : '',
        );
        const api = new FakeMachineApi();
        const { handle } = await boot({
          api,
          backend: fakeBackend(events).backend,
          claudeCodeBackend: fakeBackend(events).backend,
        });
        try {
          await waitFor(() => api.parked !== null);
          api.parked?.({
            ...CLAIMED,
            step: { ...CLAIMED.step, kind: 'build' },
            instruction: 'Hello',
            todo: undefined,
            agent: {
              ...CLAIMED.agent!,
              description: 'Context',
              provider: harness === 'claude-code' ? 'claude-code' : 'openai',
            },
          });
          await waitFor(() => api.doneBodies.length === 1);
          return api;
        } finally {
          await handle.stop();
          await handle.done;
        }
      };
      const reference = await run(false);
      const acp = await run(true);
      expect(acp.doneBodies[0]?.body).toMatchObject({
        status: 'success',
        sessionId: 'acp-session-2290',
        usage: [],
      });
      const transcripts = [acp, reference].map((api) =>
        api.uploads[0]?.body.messages.map(({ role, content }) => {
          if (
            typeof content === 'object' &&
            content !== null &&
            !Array.isArray(content) &&
            'kind' in content &&
            content.kind === 'toolcall' &&
            'call' in content &&
            typeof content.call === 'object' &&
            content.call !== null
          ) {
            const { startedAt, endedAt, ...call } = toolCallRecordSchema.parse(content.call);
            return { role, content: { kind: content.kind, call } };
          }
          return { role, content };
        }),
      );
      expect(transcripts[0]).toEqual(transcripts[1]);
      expect(acp.toolCalls.map(({ call: { startedAt, endedAt, ...call } }) => call)).toEqual(
        reference.toolCalls.map(({ call: { startedAt, endedAt, ...call } }) => call),
      );
    },
  );

  test('default and unrelated agent routing stay on the existing backend', async () => {
    vi.stubEnv(
      'CAIRN_ACP_AGENTS',
      JSON.stringify({ other: { harness: 'codex', command: 'must-not-spawn' } }),
    );
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, api } = await boot({ backend });
    try {
      await waitFor(() => api.parked !== null);
      api.parked?.(CLAIMED);
      await waitFor(() => api.doneBodies.length === 1);
      expect(created).toHaveLength(1);
      expect(api.doneBodies[0]?.body.status).toBe('success');
    } finally {
      await handle.stop();
      await handle.done;
    }
  });

  test.each([
    'refusal',
    'max_tokens',
    'max_turn_requests',
    'crash',
    'unfinished',
    'agent-cancelled',
  ])('reports %s as error, never done', async (scenario) => {
    const session = await adapter(scenario).createSession(opts);
    const events = await collect(session.events);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  test.each(['load', 'resume'])(
    'uses advertised %s without replaying old history',
    async (scenario) => {
      const session = await adapter(scenario).continueSession('acp-session-2290', opts);
      expect(await collect(session.events)).toContainEqual({
        type: 'message_end',
        message: { role: 'assistant', content: 'Hello Thread' },
      });
    },
  );

  test('unsupported resume fails without creating a new session', async () => {
    await expect(adapter().continueSession('old', opts)).rejects.toThrow('resume');
  });

  test.each(['cancel', 'ignore-cancel', 'ignore-term'])(
    'stop settles and reaps a child in %s',
    async (scenario) => {
      let child: ReturnType<typeof spawn> | undefined;
      const backend = createAcpBackend({
        harness: 'codex',
        command: process.execPath,
        args: [fixture, scenario],
        cancelTimeoutMs: 100,
        spawnProcess: (command, args, options) => {
          const spawned = spawn(command, args, { ...options, stdio: 'pipe' });
          child = spawned;
          return spawned;
        },
      });
      const session = await backend.createSession(opts);
      const iterator = session.events[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toEqual({ type: 'text_delta', text: 'started' });
      await session.stop();
      expect(await collect({ [Symbol.asyncIterator]: () => iterator })).toContainEqual(
        expect.objectContaining({ type: 'message_stop' }),
      );
      await waitFor(() => child?.exitCode !== null || child?.signalCode !== null);
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    },
  );

  test('denies permission requests', async () => {
    const session = await adapter('permission').createSession(opts);
    expect(await collect(session.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test.each(['partial-tool', 'empty-tool'])(
    'settles %s without losing incremental output',
    async (scenario) => {
      const session = await adapter(scenario).createSession(opts);
      const events = await collect(session.events);
      expect(events.filter((event) => event.type === 'toolcall_end')).toEqual([
        {
          type: 'toolcall_end',
          call: { id: 'read-1', name: 'Read', arguments: { path: 'README.md' } },
        },
        {
          type: 'toolcall_end',
          call: {
            id: 'read-1',
            name: 'Read',
            arguments: { path: 'README.md' },
            result: scenario === 'partial-tool' ? 'partial output' : '',
            isError: false,
          },
        },
      ]);
      expect(events).toContainEqual({ type: 'done', usage: [] });
    },
  );

  test('stop before reading events closes without submitting a prompt', async () => {
    const session = await adapter().createSession(opts);
    await session.stop();
    expect(await collect(session.events)).toEqual([
      { type: 'message_stop', message: { role: 'assistant', content: '' } },
    ]);
  });

  test.skipIf(process.platform === 'win32')(
    'stop reaps adapter descendants that ignore termination',
    async () => {
      const session = await adapter('descendant').createSession(opts);
      const iterator = session.events[Symbol.asyncIterator]();
      const event = (await iterator.next()).value as StepEvent;
      if (event.type !== 'text_delta') throw new Error('Missing descendant PID');
      const pid = Number(event.text);
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      try {
        await session.stop();
        await collect({ [Symbol.asyncIterator]: () => iterator });
        await waitFor(() => !alive(), 2_000);
        expect(alive()).toBe(false);
      } finally {
        if (alive()) process.kill(pid, 'SIGKILL');
      }
    },
  );

  test('missing adapter executable reports a spawn failure', async () => {
    await expect(
      createAcpBackend({
        harness: 'codex',
        command: '/missing-cairn-acp-executable',
      }).createSession(opts),
    ).rejects.toThrow('ENOENT');
  });

  test.skipIf(process.platform === 'win32').each(['exit', 'stop-exit'])(
    '%s mid-prompt reaps the adapter and its descendant within two seconds',
    async (mode) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          fileURLToPath(new URL('./fixtures/acp-exit.mjs', import.meta.url)),
          mode,
        ],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
      );
      let adapterPid: number | undefined;
      let descendantPid: number | undefined;
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      const exited = once(child, 'exit');
      try {
        const [message] = await once(child, 'message', { signal: AbortSignal.timeout(3_000) });
        const pids = message as {
          adapterPid: number;
          descendantPid: number;
        };
        ({ adapterPid, descendantPid } = pids);
        expect(alive(adapterPid)).toBe(true);
        expect(alive(descendantPid)).toBe(true);
        child.send('exit');
        expect(await exited).toEqual([0, null]);
        await expect
          .poll(() => [alive(pids.adapterPid), alive(pids.descendantPid)], { timeout: 2_000 })
          .toEqual([false, false]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
        if (adapterPid !== undefined && alive(adapterPid)) process.kill(-adapterPid, 'SIGKILL');
        if (descendantPid !== undefined && alive(descendantPid))
          process.kill(descendantPid, 'SIGKILL');
      }
    },
  );

  test('allows a single permission only under the explicit per-agent policy', async () => {
    const session = await createAcpBackend({
      harness: 'codex',
      command: process.execPath,
      args: [fixture, 'permission-allow'],
      permissions: 'allow-once',
    }).createSession(opts);
    expect(await collect(session.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test('preserves failed tool results', async () => {
    const session = await adapter('tool-failed').createSession(opts);
    expect(await collect(session.events)).toContainEqual({
      type: 'toolcall_end',
      call: {
        id: 'read-1',
        name: 'Read',
        arguments: { path: 'README.md' },
        result: 'file content',
        isError: true,
      },
    });
  });

  test('rejects competing steering without acknowledging delivery', async () => {
    const session = await adapter().createSession(opts);
    await expect(session.steer('extra')).rejects.toThrow('steer');
    await collect(session.events);
  });

  test('requires advertised image support and delivers pixels', async () => {
    const images = { ...opts, promptImages: [{ data: 'aA==', mimeType: 'image/png' }] };
    await expect(adapter().createSession(images)).rejects.toThrow('image capability');
    const session = await adapter('image').createSession(images);
    expect(await collect(session.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test.each(['no-model', 'bad-version', 'hang-init'])('fails closed on %s', async (scenario) => {
    await expect(adapter(scenario).createSession(opts)).rejects.toThrow();
  });

  test.each([
    { readOnly: true },
    { remoteToolsOnly: true },
    { skillsAllowlist: [] },
    { injectedSkills: ['private'] },
  ])('rejects unsupported session policy %j', async (policy) => {
    await expect(adapter().createSession({ ...opts, ...policy })).rejects.toThrow('unsupported');
  });

  test('relays declared local and remote tools through authenticated MCP and closes the listener', async () => {
    const remote = vi.fn(async () => 'remote output');
    const local = vi.fn(async () => 'local output');
    const session = await adapter('host-tools').createSession({
      ...opts,
      remoteTools: [
        { name: 'remote', description: 'Remote', parameters: { type: 'object', properties: {} } },
      ],
      executeRemoteTool: remote,
      localTools: [{ name: 'local', description: 'Local', execute: local }],
    });
    expect(await collect(session.events)).toContainEqual({ type: 'done', usage: [] });
    expect(remote).toHaveBeenCalledWith('remote', { text: 'input' });
    expect(local).toHaveBeenCalledWith({ text: 'input' });
  });

  test('remote tools require a relay before spawning', async () => {
    await expect(
      adapter().createSession({
        ...opts,
        remoteTools: [{ name: 'remote', description: 'Remote' }],
      }),
    ).rejects.toThrow('relay');
  });

  test('validates configuration without shell execution', () => {
    expect(configuredAcpBackends(undefined).size).toBe(0);
    expect(() => configuredAcpBackends('{')).toThrow();
    expect(() => configuredAcpBackends('{"a1":{"harness":"grok","command":"grok"}}')).toThrow();
    expect(() => configuredAcpBackends('{"a1":{"harness":"codex","command":""}}')).toThrow();
  });
});

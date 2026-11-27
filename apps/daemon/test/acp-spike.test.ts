import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { type SessionOpts, type StepEvent, toolCallRecordSchema } from '@cairn/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test, vi } from 'vitest';
import { createAcpBackend, createGeminiBackend } from '../src/backend/acp.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
const opts: SessionOpts = {
  cwd: process.cwd(),
  provider: { kind: 'api_key', providerId: 'openai' },
  modelId: 'stub-model',
  prompt: 'Hello',
};

function adapter(scenario = 'complete', harness: 'claude-code' = 'claude-code') {
  return createAcpBackend({
    harness,
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

describe('ACP spike with a real scripted stdio child', () => {
  test.each(['claude-code'] as const)(
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
        const api = new FakeMachineApi();
        if (harness === 'claude-code') api.claudeSubscriptionToken = 'acp-subscription-token';
        const acpBackend = acp ? adapter('complete', harness) : null;
        const { handle } = await boot({
          api,
          backend: acpBackend ?? fakeBackend(events).backend,
          claudeCodeBackend: acpBackend ?? fakeBackend(events).backend,
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
        harness: 'claude-code',
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
        harness: 'claude-code',
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
        const [message] = await once(child, 'message', { signal: AbortSignal.timeout(20_000) });
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
    30_000,
  );

  test('allows a single permission only under the explicit per-agent policy', async () => {
    const session = await createAcpBackend({
      harness: 'claude-code',
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

  test('rejects competing steering on a direct session call', async () => {
    const session = await adapter().createSession(opts);
    await expect(session.steer('extra')).rejects.toThrow('steer');
    await collect(session.events);
  });

  test.each(['claude-code'] as const)(
    '%s leaves unsupported steering queued through the daemon and runner',
    async (harness) => {
      const api = new FakeMachineApi();
      let pending: string | null = 'Keep this instruction queued';
      const fetchSteer = vi.spyOn(api, 'steer').mockImplementation(async () => {
        const content = pending;
        pending = null;
        return { content };
      });
      const ack = vi.spyOn(api, 'steerAck');
      const token = api.token.bind(api);
      vi.spyOn(api, 'token').mockImplementation(async (stepId) => {
        api.onStreamEvent?.({ type: 'steer', stepId });
        return token(stepId);
      });
      const { handle, lines } = await boot({ api, backend: adapter('cancel', harness) });
      try {
        await waitFor(() => api.parked !== null);
        api.parked?.({
          ...CLAIMED,
          step: { ...CLAIMED.step, kind: 'build' },
          instruction: 'Hello',
          todo: undefined,
        });
        await waitFor(() => api.calls.some((call) => call.startsWith('transcriptDelta:s1:')));
        expect(pending).toBe('Keep this instruction queued');
        api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
        await waitFor(() => lines.filter((line) => line.includes('steer ')).length === 2);
        expect(pending).toBe('Keep this instruction queued');
        expect(fetchSteer).not.toHaveBeenCalled();
        expect(ack).not.toHaveBeenCalled();
      } finally {
        api.stopResponse = false;
        api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
        await waitFor(() => api.doneBodies.length === 1);
        await handle.stop();
        await handle.done;
      }
    },
  );

  test.each(
    (['claude-code'] as const).flatMap((harness) =>
      [[], [{ slug: 'host', transport: 'http' as const, url: 'http://host' }]].map(
        (mcpServers) => ({ harness, mcpServers }),
      ),
    ),
  )(
    '$harness rejects external MCP set $mcpServers before spawning',
    async ({ harness, mcpServers }) => {
      const spawnProcess = vi.fn(() => {
        throw new Error('Adapter must not spawn');
      });
      const backend = createAcpBackend({ harness, command: 'must-not-spawn', spawnProcess });
      await expect(backend.createSession({ ...opts, mcpServers })).rejects.toThrow(
        'ACP mcpServers policy is unsupported: adapter host MCP configuration is not isolated',
      );
      expect(spawnProcess).not.toHaveBeenCalled();
    },
  );

  test.each([{ mcpServers: [] }, { mcpServers: ['host'] }])(
    'fails the daemon step for external MCP policy $mcpServers',
    async ({ mcpServers }) => {
      const { api, handle } = await boot({
        backend: createAcpBackend({ harness: 'claude-code', command: 'must-not-spawn' }),
      });
      try {
        await waitFor(() => api.parked !== null);
        api.parked?.({ ...CLAIMED, mcpServers });
        await waitFor(() => api.doneBodies.length === 1);
        expect(api.doneBodies[0]?.body).toMatchObject({
          status: 'failed',
          errorMessage:
            'ACP mcpServers policy is unsupported: adapter host MCP configuration is not isolated',
        });
      } finally {
        await handle.stop();
        await handle.done;
      }
    },
  );

  test('requires advertised image support and delivers pixels', async () => {
    const images = { ...opts, promptImages: [{ data: 'aA==', mimeType: 'image/png' }] };
    await expect(adapter().createSession(images)).rejects.toThrow('image capability');
    const session = await adapter('image').createSession(images);
    expect(await collect(session.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test.each(['no-model', 'bad-version', 'hang-init'])('fails closed on %s', async (scenario) => {
    await expect(adapter(scenario).createSession(opts)).rejects.toThrow();
  });

  test('enforces readOnly and remoteToolsOnly permission policies and strips external MCP', async () => {
    const ext = [{ slug: 'ext', transport: 'http' as const, url: 'http://127.0.0.1:9/mcp' }];
    const remote = vi.fn(async () => 'remote output');
    const sharedOpts = {
      ...opts,
      mcpServers: ext,
      remoteTools: [
        { name: 'remote', description: 'Remote', parameters: { type: 'object', properties: {} } },
      ],
      executeRemoteTool: remote,
    };

    const readOnlySession = await createAcpBackend({
      harness: 'claude-code',
      command: process.execPath,
      args: [fixture, 'policy-readonly'],
      permissions: 'allow-once',
      allowHostMcp: true,
    }).createSession({ ...sharedOpts, readOnly: true });
    expect(await collect(readOnlySession.events)).toContainEqual({ type: 'done', usage: [] });

    const remoteOnlySession = await createAcpBackend({
      harness: 'claude-code',
      command: process.execPath,
      args: [fixture, 'policy-remote-tools-only'],
      permissions: 'allow-once',
      allowHostMcp: true,
    }).createSession({ ...sharedOpts, remoteToolsOnly: true });
    expect(await collect(remoteOnlySession.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test.each([
    ['max', 'max'],
    ['xhigh', 'unset'],
  ])(
    'sets thinking %s from the selected model thought_level values, never a neighbour (expects %s)',
    async (thinkingLevel, expected) => {
      const backend = createAcpBackend({
        harness: 'claude-code',
        command: process.execPath,
        args: [fixture, 'thinking', expected],
        initializeTimeoutMs: 3_000,
        cancelTimeoutMs: 100,
      });
      const session = await backend.createSession({
        ...opts,
        thinkingLevel,
        skillsAllowlist: [],
        injectedSkills: ['sample-skill'],
      });
      expect(await collect(session.events)).toContainEqual({ type: 'done', usage: [] });
    },
  );

  test('tolerates an adapter without thinking options', async () => {
    const withoutThinking = await adapter('complete').createSession({
      ...opts,
      thinkingLevel: 'xhigh',
      injectedSkills: ['sample-skill'],
    });
    expect(await collect(withoutThinking.events)).toContainEqual({ type: 'done', usage: [] });
  });

  test('bridges external HTTP MCP connectors over stdio when agent lacks mcpCapabilities.http', async () => {
    const upstream = createHttpServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body =
        chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const server = new Server({ name: 'ext', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [{ name: 'ext_ping', description: 'Ping', inputSchema: { type: 'object' } }],
      }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
        content: [{ type: 'text', text: `${params.name} output` }],
      }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.once('close', () => void server.close().catch(() => {}));
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const addr = upstream.address() as { port: number };
    try {
      const session = await createAcpBackend({
        harness: 'claude-code',
        command: process.execPath,
        args: [fixture, 'no-http-mcp'],
        allowHostMcp: true,
      }).createSession({
        ...opts,
        mcpServers: [{ slug: 'ext', transport: 'http', url: `http://127.0.0.1:${addr.port}/mcp` }],
      });
      expect(await collect(session.events)).toContainEqual({ type: 'done', usage: [] });
    } finally {
      upstream.close();
      upstream.closeAllConnections();
    }
  });

  test('Gemini backend relays local and remote tools over stdio MCP', async () => {
    const remote = vi.fn(async () => 'remote output');
    const local = vi.fn(async () => 'local output');
    const session = await createGeminiBackend({
      executablePath: process.execPath,
      spawnProcess: (_cmd, _args, spawnOpts) =>
        spawn(process.execPath, [fixture, 'host-tools'], spawnOpts),
    }).createSession({
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

  test.each(['antigravity', 'devin', 'claude-code', 'gemini'] as const)(
    '%s: continues a session with host tools callable via coalesced stdio MCP after restart',
    async (harness) => {
      const remote = vi.fn(async () => 'todo-from-resumed');
      const fakeScript = `
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
const send = (v) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...v }) + '\\n');
let host = null;
let preloaded = null;
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true } } });
  } else if (method === 'session/load') {
    host = (params.mcpServers ?? []).find((s) => s.name === 'cairn') ?? null;
    const [portStr, token] = host.args.slice(-2);
    const discover = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { padding: 'x'.repeat(280) } });
    const init = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent', version: '1' } } });
    const list = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
    const call = JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'todos', arguments: {} } });
    preloaded = await new Promise((resolve, reject) => {
      const sock = createConnection(Number(portStr), '127.0.0.1', () => {
        sock.write(token + '\\n' + discover + '\\n' + init + '\\n' + list + '\\n' + call + '\\n');
      });
      const replies = [];
      createInterface({ input: sock }).on('line', (l) => {
        if (!l.trim()) return;
        replies.push(JSON.parse(l));
        if (replies.length === 4) { sock.destroy(); resolve(replies); }
      });
      sock.on('error', reject);
      sock.on('close', () => { if (replies.length < 4) reject(new Error('MCP closed early')); });
    });
    send({ id, result: { sessionId: params.sessionId, modes: { currentModeId: 'bypass', availableModes: [{ id: 'bypass', name: 'Bypass' }] }, configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'stub-model', options: [{ value: 'stub-model', name: 'Stub' }] }] } });
  } else if (method === 'session/set_mode') {
    send({ id, result: {} });
  } else if (method === 'session/set_config_option') {
    send({ id, result: { configOptions: [] } });
  } else if (method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 's-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: preloaded.find((r) => r.id === 4).result.content[0].text } } } });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
`;
      const backend =
        harness === 'gemini'
          ? createGeminiBackend({
              executablePath: process.execPath,
              spawnProcess: (_cmd, _args, spawnOpts) =>
                spawn(process.execPath, ['--input-type=module', '-e', fakeScript], spawnOpts),
            })
          : createAcpBackend({
              harness,
              command: process.execPath,
              args: ['--input-type=module', '-e', fakeScript],
              allowHostMcp: true,
              sessionResume: true,
            });
      const session = await backend.continueSession('s-1', {
        ...opts,
        remoteTools: [{ name: 'todos', description: 'List todos' }],
        executeRemoteTool: remote,
      });
      const events = await collect(session.events);
      expect(events).toContainEqual({
        type: 'message_end',
        message: { role: 'assistant', content: 'todo-from-resumed' },
      });
      expect(events).toContainEqual({ type: 'done', usage: [] });
      expect(remote).toHaveBeenCalledWith('todos', {});
    },
  );

  test.each(['antigravity', 'devin', 'claude-code', 'gemini'] as const)(
    '%s: flags an unattached Cairn MCP session when a declared host tool fails with unknown tool, but stays silent once tools/list ran',
    async (harness) => {
      const makeAgent = async (attachMcp: boolean) => {
        const fakeScript = `
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const send = (v) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...v }) + '\\n');
let host = null;
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true } } });
  } else if (method === 'session/new' || method === 'session/load') {
    host = (params.mcpServers ?? []).find((s) => s.name === 'cairn') ?? null;
    if (${JSON.stringify(attachMcp)} && host) {
      const child = spawn(host.command, host.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const waiters = new Map();
      createInterface({ input: child.stdout }).on('line', (l) => {
        if (!l.trim()) return;
        const m = JSON.parse(l);
        const w = waiters.get(m.id);
        if (w) { waiters.delete(m.id); w(m); }
      });
      let nid = 1;
      const rpc = (m, p) => new Promise((res) => { const rid = nid++; waiters.set(rid, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: m, params: p }) + '\\n'); });
      await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
      await rpc('tools/list', {});
      child.stdin.end();
      child.kill('SIGTERM');
    }
    send({ id, result: { sessionId: 's-1', modes: { currentModeId: 'bypass', availableModes: [{ id: 'bypass', name: 'Bypass' }] }, configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'stub-model', options: [{ value: 'stub-model', name: 'Stub' }] }] } });
  } else if (method === 'session/set_mode') {
    send({ id, result: {} });
  } else if (method === 'session/set_config_option') {
    send({ id, result: { configOptions: [] } });
  } else if (method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 's-1', update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'mcp_cairn_todos', kind: 'other', rawInput: {}, status: 'pending' } } });
    send({ method: 'session/update', params: { sessionId: 's-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'failed', rawOutput: 'unknown tool: "mcp_cairn_todos" — check spelling' } } });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
`;
        const backend =
          harness === 'gemini'
            ? createGeminiBackend({
                executablePath: process.execPath,
                spawnProcess: (_cmd, _args, spawnOpts) =>
                  spawn(process.execPath, ['--input-type=module', '-e', fakeScript], spawnOpts),
              })
            : createAcpBackend({
                harness,
                command: process.execPath,
                args: ['--input-type=module', '-e', fakeScript],
                allowHostMcp: true,
                sessionResume: true,
              });
        const sessionOpts = {
          ...opts,
          remoteTools: [{ name: 'todos', description: 'List todos' }],
          executeRemoteTool: async () => '[]',
        };
        const session = await backend.continueSession('s-1', sessionOpts);
        return collect(session.events);
      };

      const unattached = await makeAgent(false);
      expect(unattached.some((e) => e.type === 'done')).toBe(false);
      expect(unattached).toContainEqual({
        type: 'error',
        error: {
          message: expect.stringContaining('Cairn host tools did not attach'),
          retryable: false,
        },
      });

      const attached = await makeAgent(true);
      expect(attached).toContainEqual({ type: 'done', usage: [] });
      expect(attached.some((e) => e.type === 'error')).toBe(false);
    },
  );

  test('detects missing host tools via _meta toolName even when title is a display string', async () => {
    const fakeScript = `
import { createInterface } from 'node:readline';
const send = (v) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...v }) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true } } });
  } else if (method === 'session/load') {
    send({ id, result: { sessionId: 's-meta', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'stub-model', options: [{ value: 'stub-model', name: 'Stub' }] }] } });
  } else if (method === 'session/set_config_option') {
    send({ id, result: { configOptions: [] } });
  } else if (method === 'session/prompt') {
    send({
      method: 'session/update',
      params: {
        sessionId: 's-meta',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-meta',
          title: 'Listing project tasks',
          kind: 'other',
          _meta: { claudeCode: { toolName: 'mcp__cairn__todos' } },
          rawInput: {},
          status: 'pending',
        },
      },
    });
    send({
      method: 'session/update',
      params: {
        sessionId: 's-meta',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-meta',
          status: 'failed',
          rawOutput: 'unknown tool: "mcp__cairn__todos"',
        },
      },
    });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
`;
    const backend = createAcpBackend({
      harness: 'claude-code',
      command: process.execPath,
      args: ['--input-type=module', '-e', fakeScript],
      allowHostMcp: true,
    });
    const session = await backend.continueSession('s-meta', {
      ...opts,
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      executeRemoteTool: async () => '[]',
    });
    const events = await collect(session.events);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events).toContainEqual({
      type: 'error',
      error: {
        message: expect.stringContaining('Cairn host tools did not attach'),
        retryable: false,
      },
    });
  });

  test('gemini: detects missing host tools even when progress content precedes failed rawOutput', async () => {
    const fakeScript = `
import { createInterface } from 'node:readline';
const send = (v) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...v }) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true } } });
  } else if (method === 'session/load') {
    send({ id, result: { sessionId: 's-gem-split', configOptions: [] } });
  } else if (method === 'session/prompt') {
    send({
      method: 'session/update',
      params: {
        sessionId: 's-gem-split',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-gem-1',
          title: 'mcp_cairn_todos',
          kind: 'other',
          rawInput: {},
          content: [{ type: 'text', text: 'running' }],
        },
      },
    });
    send({
      method: 'session/update',
      params: {
        sessionId: 's-gem-split',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-gem-1',
          rawOutput: 'unknown tool: "mcp_cairn_todos"',
        },
      },
    });
    send({
      method: 'session/update',
      params: {
        sessionId: 's-gem-split',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-gem-1',
          status: 'failed',
        },
      },
    });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
`;
    const backend = createGeminiBackend({
      executablePath: process.execPath,
      spawnProcess: (_cmd, _args, spawnOpts) =>
        spawn(process.execPath, ['--input-type=module', '-e', fakeScript], spawnOpts),
    });
    const session = await backend.continueSession('s-gem-split', {
      ...opts,
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      executeRemoteTool: async () => '[]',
    });
    const events = await collect(session.events);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events).toContainEqual({
      type: 'error',
      error: {
        message: expect.stringContaining('Cairn host tools did not attach'),
        retryable: false,
      },
    });
  });

  test('clears missingHostToolsError if MCP attaches and succeeds later in the same turn', async () => {
    const fakeScript = `
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
const send = (v) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...v }) + '\\n');
let host = null;
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true } } });
  } else if (method === 'session/load') {
    host = (params.mcpServers ?? []).find((s) => s.name === 'cairn') ?? null;
    send({ id, result: { sessionId: 's-recover', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'stub-model', options: [{ value: 'stub-model', name: 'Stub' }] }] } });
  } else if (method === 'session/set_config_option') {
    send({ id, result: { configOptions: [] } });
  } else if (method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 's-recover', update: { sessionUpdate: 'tool_call', toolCallId: 'tc-fail', title: 'mcp_cairn_todos', kind: 'other', rawInput: {}, status: 'pending' } } });
    send({ method: 'session/update', params: { sessionId: 's-recover', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-fail', status: 'failed', rawOutput: 'unknown tool: "mcp_cairn_todos"' } } });
    const [portStr, token] = host.args.slice(-2);
    const out = await new Promise((resolve, reject) => {
      const sock = createConnection(Number(portStr), '127.0.0.1', () => {
        sock.write(
          token + '\\n' +
          JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) + '\\n' +
          JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\\n' +
          JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'todos', arguments: {} } }) + '\\n',
        );
      });
      const replies = [];
      createInterface({ input: sock }).on('line', (l) => {
        if (!l.trim()) return;
        replies.push(JSON.parse(l));
        if (replies.length === 3) { sock.destroy(); resolve(replies); }
      });
      sock.on('error', reject);
    });
    const text = out.find((r) => r.id === 3).result.content[0].text;
    send({ method: 'session/update', params: { sessionId: 's-recover', update: { sessionUpdate: 'tool_call', toolCallId: 'tc-ok', title: 'mcp_cairn_todos', kind: 'other', rawInput: {}, status: 'completed', rawOutput: text } } });
    send({ method: 'session/update', params: { sessionId: 's-recover', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
    send({ id, result: { stopReason: 'end_turn' } });
  }
}
`;
    const backend = createAcpBackend({
      harness: 'antigravity',
      command: process.execPath,
      args: ['--input-type=module', '-e', fakeScript],
      allowHostMcp: true,
    });
    const session = await backend.continueSession('s-recover', {
      ...opts,
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      executeRemoteTool: async () => 'recovered-todos',
    });
    const events = await collect(session.events);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'recovered-todos' },
    });
    expect(events).toContainEqual({ type: 'done', usage: [] });
  });

  test('devin: steering into a clean prompt clears missingHostToolsError from the interrupted prompt', async () => {
    const fakeScript = `
import { createInterface } from 'node:readline';
const send = (v) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...v }) + '\\n');
let promptCount = 0;
let firstPromptId = null;
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true } } });
  } else if (method === 'session/load') {
    send({ id, result: { sessionId: 's-steer', modes: { currentModeId: 'bypass', availableModes: [{ id: 'bypass', name: 'Bypass' }] }, configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'stub-model', options: [{ value: 'stub-model', name: 'Stub' }] }] } });
  } else if (method === 'session/set_mode') {
    send({ id, result: {} });
  } else if (method === 'session/set_config_option') {
    send({ id, result: { configOptions: [] } });
  } else if (method === 'session/prompt') {
    promptCount += 1;
    if (promptCount === 1) {
      firstPromptId = id;
      send({ method: 'session/update', params: { sessionId: 's-steer', update: { sessionUpdate: 'tool_call', toolCallId: 'tc-s1', title: 'mcp_cairn_todos', kind: 'other', rawInput: {}, status: 'pending' } } });
      send({ method: 'session/update', params: { sessionId: 's-steer', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-s1', status: 'failed', rawOutput: 'unknown tool: "mcp_cairn_todos"' } } });
      send({ method: 'session/update', params: { sessionId: 's-steer', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ready-for-steer' } } } });
    } else {
      send({ id: firstPromptId, result: { stopReason: 'interrupted' } });
      send({ method: 'session/update', params: { sessionId: 's-steer', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'steered-ok' } } } });
      send({ id, result: { stopReason: 'end_turn' } });
    }
  }
}
`;
    const backend = createAcpBackend({
      harness: 'devin',
      command: process.execPath,
      args: ['--input-type=module', '-e', fakeScript],
      allowHostMcp: true,
      steering: 'mid-turn',
    });
    const session = await backend.continueSession('s-steer', {
      ...opts,
      remoteTools: [{ name: 'todos', description: 'List todos' }],
      executeRemoteTool: async () => '[]',
    });
    const events: StepEvent[] = [];
    let steered = false;
    for await (const ev of session.events) {
      events.push(ev);
      if (!steered && ev.type === 'text_delta' && ev.text.includes('ready-for-steer')) {
        steered = true;
        await session.steer?.('just answer hi');
      }
    }
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events).toContainEqual({
      type: 'message_end',
      message: { role: 'assistant', content: 'steered-ok' },
    });
    expect(events).toContainEqual({ type: 'done', usage: [] });
  });
});

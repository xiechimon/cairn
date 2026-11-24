import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { delimiter, join } from 'node:path';
import type { SessionOpts } from '@cairn/shared';
import { createAgentSession } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test, vi } from 'vitest';
import { daemonOtelFromEnv } from '../src/backend/otel.js';
import { type AgentSessionEventLike, createPiBackend } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>();
  return { ...actual, createAgentSession: vi.fn(actual.createAgentSession) };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const exporterEnv = {
  CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:9/api/public/otel',
  CAIRN_OTEL_HEADERS: 'authorization=synthetic-exporter-key',
  CAIRN_OTEL_ENVIRONMENT: 'production',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
  OTEL_SDK_DISABLED: 'false',
  ANT_OTEL_ENDPOINT: 'http://127.0.0.1:9',
  BETA_TRACING_ENDPOINT: 'http://127.0.0.1:9',
  ENABLE_BETA_TRACING_DETAILED: '1',
};

test.each([undefined, { ...exporterEnv, FOO: 'step-value' }])(
  'pi bash children scrub inherited and step exporters with overrides %j',
  async (env) => {
    const directory = testTempDir('cairn-pi-child-env-');
    for (const [key, value] of Object.entries(exporterEnv)) vi.stubEnv(key, value);
    vi.stubEnv('HOME', directory);
    vi.stubEnv('FOO', 'daemon-value');
    vi.stubEnv('GH_TOKEN', 'daemon-gh-token');
    vi.stubEnv('GITHUB_TOKEN', 'daemon-github-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'daemon-anthropic-key');
    const path = process.env.PATH;
    const before = { ...process.env };
    const backend = createPiBackend({
      agentDir: join(directory, 'agent'),
      sessionDir: join(directory, 'sessions'),
      skills: { skillsDir: join(directory, 'skills'), cwd: directory },
    });
    const opts: SessionOpts = {
      cwd: directory,
      provider: {
        kind: 'http',
        providerId: 'synthetic',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        models: [{ id: 'synthetic', name: 'Synthetic' }],
      },
      modelId: 'synthetic',
      ...(env !== undefined ? { env } : {}),
    };
    const handle = await backend.createSession(opts);
    try {
      const bash = vi
        .mocked(createAgentSession)
        .mock.calls.at(-1)?.[0]
        ?.customTools?.find((tool) => tool.name === 'bash');
      expect(bash).toBeDefined();
      const result = await bash!.execute(
        'env-probe',
        { command: "node -e 'process.stdout.write(JSON.stringify(process.env))'" },
        undefined,
        undefined,
        undefined as never,
      );
      const output = result.content.find((part) => part.type === 'text');
      if (output?.type !== 'text') throw new Error('Missing child environment output');
      const child = JSON.parse(output.text) as Record<string, string>;
      for (const key of Object.keys(exporterEnv)) {
        if (key !== 'OTEL_SDK_DISABLED') expect(child).not.toHaveProperty(key);
      }
      expect(child.GH_TOKEN).toBe('daemon-gh-token');
      expect(child.GITHUB_TOKEN).toBe('daemon-github-token');
      expect(child.OTEL_SDK_DISABLED).toBe('true');
      expect(child).toMatchObject({
        PATH: `${join(directory, 'agent', 'bin')}${delimiter}${path}`,
        HOME: directory,
      });
      expect(child.FOO).toBe(env?.FOO ?? 'daemon-value');
      for (const key of Object.keys(exporterEnv)) expect(process.env[key]).toBe(before[key]);
      expect(daemonOtelFromEnv(process.env)?.contextFor('build', 'step').environment).toBe(
        'production',
      );
    } finally {
      await handle.stop();
    }
  },
);

test('the embedded pi keeps its agent dir and pins out of task commands', async () => {
  const directory = testTempDir('cairn-pi-pins-');
  vi.stubEnv('HOME', directory);
  vi.stubEnv('PI_CODING_AGENT_DIR', undefined);
  const backend = createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
    skills: { skillsDir: join(directory, 'skills'), cwd: directory },
  });
  expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();
  expect(process.env.PI_SKIP_VERSION_CHECK).toBe('1');
  vi.stubEnv('PI_TELEMETRY', 'operator-choice');
  const handle = await backend.createSession({
    ...syntheticSession(directory),
    env: { PI_SKIP_VERSION_CHECK: '1' },
  });
  try {
    const child = await bashChildEnv();
    expect(child).not.toHaveProperty('PI_CODING_AGENT_DIR');
    expect(child).not.toHaveProperty('PI_OFFLINE');
    expect(child.PI_SKIP_VERSION_CHECK).toBe('1');
    expect(child).not.toHaveProperty('PI_TELEMETRY');
  } finally {
    await handle.stop();
  }
});

test('the embedded pi never falls back to the user pi directory', async () => {
  const directory = testTempDir('cairn-pi-home-');
  vi.stubEnv('HOME', directory);
  vi.stubEnv('PI_CODING_AGENT_DIR', undefined);
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.headers.authorization ?? '');
    response.writeHead(500).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const backend = createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
    skills: { skillsDir: join(directory, 'skills'), cwd: directory },
  });
  const handle = await backend.createSession({
    ...syntheticSession(directory),
    mcpServers: [{ slug: 'stub', transport: 'http', url: `http://127.0.0.1:${port}/mcp` }],
  });
  try {
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0), { timeout: 10_000 });
    const child = await bashChildEnv();
    expect(child.PATH?.split(delimiter)[0]).toBe(join(directory, 'agent', 'bin'));
    expect(child.PATH).not.toContain(join(directory, '.pi'));
    expect(existsSync(join(directory, '.pi'))).toBe(false);
  } finally {
    await handle.stop();
    server.close();
  }
});

function syntheticSession(directory: string): SessionOpts {
  return {
    cwd: directory,
    provider: {
      kind: 'http',
      providerId: 'synthetic',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      models: [{ id: 'synthetic', name: 'Synthetic' }],
    },
    modelId: 'synthetic',
  };
}

async function bashChildEnv(): Promise<Record<string, string>> {
  const bash = vi
    .mocked(createAgentSession)
    .mock.calls.at(-1)?.[0]
    ?.customTools?.find((tool) => tool.name === 'bash');
  const result = await bash!.execute(
    'env-probe',
    { command: "node -e 'process.stdout.write(JSON.stringify(process.env))'" },
    undefined,
    undefined,
    undefined as never,
  );
  const output = result.content.find((part) => part.type === 'text');
  if (output?.type !== 'text') throw new Error('Missing child environment output');
  return JSON.parse(output.text) as Record<string, string>;
}

async function steeringSession(baseUrl?: string) {
  const directory = testTempDir('cairn-pi-steer-');
  const opts = syntheticSession(directory);
  const handle = await createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
  }).createSession({ ...opts, provider: { ...opts.provider, ...(baseUrl ? { baseUrl } : {}) } });
  const { session }: Awaited<ReturnType<typeof createAgentSession>> = await vi
    .mocked(createAgentSession)
    .mock.results.at(-1)!.value;
  const emitter = session as unknown as { _emit(event: AgentSessionEventLike): void };
  return { handle, session, emit: (event: AgentSessionEventLike) => emitter._emit(event) };
}

test('pi steer waits for consumption and rejects a late enqueue when the agent settles', async () => {
  const { handle, emit } = await steeringSession();
  const outcome = vi.fn();
  const receipt = handle.steer('Too late').then(
    () => outcome('consumed'),
    () => outcome('rejected'),
  );
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(outcome).not.toHaveBeenCalled();
    emit({ type: 'agent_settled' });
    await receipt;
    expect(outcome).toHaveBeenCalledExactlyOnceWith('rejected');
    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['done']);
  } finally {
    await handle.stop();
  }
});

test('pi receipts match user content including images and count start/end only once', async () => {
  const { handle, session, emit } = await steeringSession();
  const outcomes: string[] = [];
  const image = { data: 'aW1n', mimeType: 'image/png' };
  const first = handle.steer('Same text', [image]).then(() => outcomes.push('first'));
  const second = handle.steer('Same text', [image]).then(() => outcomes.push('second'));
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(outcomes).toEqual([]);
    expect(session.model?.input).toContain('image');
    const queued = session.agent.peekQueuedMessages()[0];
    expect(queued?.role === 'user' ? queued.content : undefined).toEqual([
      { type: 'text', text: 'Same text' },
      { type: 'image', ...image },
    ]);
    for (const message of [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Same text' },
          { type: 'image', ...image },
        ],
      },
      { role: 'user', content: 'Same text' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Same text' },
          { type: 'image', ...image, data: 'other' },
        ],
      },
    ]) {
      emit({ type: 'message_start', message });
      emit({ type: 'message_end', message });
    }
    await Promise.resolve();
    expect(outcomes).toEqual([]);
    const message = {
      role: 'user',
      content: [
        { type: 'text', text: 'Same text' },
        { type: 'image', ...image },
      ],
    };
    emit({ type: 'message_start', message });
    await first;
    expect(outcomes).toEqual(['first']);
    emit({ type: 'message_end', message });
    await Promise.resolve();
    expect(outcomes).toEqual(['first']);
    emit({ type: 'message_end', message: { ...message } });
    await second;
    expect(outcomes).toEqual(['first', 'second']);
  } finally {
    await handle.stop();
  }
});

test.each(['stop', 'error'] as const)(
  'pi rejects pending and future receipts on %s',
  async (end) => {
    const { handle } = await steeringSession();
    const receipt = expect(handle.steer('Pending')).rejects.toThrow(/consum|clos|stop/i);
    if (end === 'stop') {
      await handle.stop();
    } else {
      (handle as unknown as { emitBackendError(message: string): void }).emitBackendError('Failed');
    }
    await receipt;
    await expect(handle.steer('After finish')).rejects.toThrow(/clos|stop/i);
    await handle.stop();
  },
);

test('pi rejects enqueue failures without rejecting a later matching receipt', async () => {
  const { handle, session, emit } = await steeringSession();
  vi.spyOn(session, 'steer').mockRejectedValueOnce(new Error('enqueue failed'));
  try {
    await expect(handle.steer('Retry text')).rejects.toThrow('enqueue failed');
    const receipt = handle.steer('Retry text');
    await new Promise<void>((resolve) => setImmediate(resolve));
    emit({ type: 'message_start', message: { role: 'user', content: 'Retry text' } });
    await receipt;
  } finally {
    await handle.stop();
  }
});

test('pi tracks consumption before enqueue resolves and ignores an already-started user message', async () => {
  const { handle, session, emit } = await steeringSession();
  const earlier = { role: 'user', content: 'Instruction' };
  emit({ type: 'message_start', message: earlier });
  const outcome = vi.fn();
  vi.spyOn(session, 'steer').mockImplementationOnce(async () => {
    emit({ type: 'message_end', message: earlier });
    emit({ type: 'agent_end' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(outcome).not.toHaveBeenCalled();
    emit({ type: 'message_start', message: { role: 'user', content: 'Instruction' } });
    return 'queued';
  });
  try {
    await handle.steer('Instruction', []).then(outcome);
    expect(outcome).toHaveBeenCalledOnce();
  } finally {
    await handle.stop();
  }
});

test.each(['before polling', 'after agent_end', 'after final poll'])(
  'real pi loop reports steer consumption accurately %s',
  async (timing) => {
    const bodies: string[] = [];
    let steer: () => void = () => {};
    let receipt: Promise<void> | undefined;
    const outcomes: string[] = [];
    let pendingBeforePolling = false;
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      bodies.push(raw);
      if (timing === 'before polling' && bodies.length === 1) {
        steer();
        await new Promise<void>((resolve) => setImmediate(resolve));
        pendingBeforePolling = outcomes.length === 0;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({
          id: 'synthetic-response',
          object: 'chat.completion.chunk',
          model: 'synthetic',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' },
          ],
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const { handle, session } = await steeringSession(`http://127.0.0.1:${port}/v1`);
    steer = () => {
      receipt = handle.steer('Steered instruction').then(
        () => {
          outcomes.push('consumed');
        },
        () => {
          outcomes.push('rejected');
        },
      );
    };
    if (timing === 'after agent_end') {
      session.subscribe((event) => {
        if (event.type === 'agent_end' && receipt === undefined) steer();
      });
    }
    if (timing === 'after final poll') {
      const boundary = session as unknown as { _runBeforeSettleBoundary(): Promise<boolean> };
      const beforeSettle = boundary._runBeforeSettleBoundary.bind(boundary);
      vi.spyOn(boundary, '_runBeforeSettleBoundary').mockImplementationOnce(async () => {
        const continueRun = await beforeSettle();
        expect(continueRun).toBe(false);
        steer();
        return continueRun;
      });
    }
    try {
      await session.prompt('Original instruction');
      expect(receipt).toBeDefined();
      await receipt;
      const consumed = timing !== 'after final poll';
      expect(outcomes).toEqual([consumed ? 'consumed' : 'rejected']);
      expect(bodies).toHaveLength(consumed ? 2 : 1);
      if (timing === 'before polling') expect(pendingBeforePolling).toBe(true);
      if (consumed) expect(bodies[1]).toContain('Steered instruction');
      const events = [];
      for await (const event of handle.events) events.push(event);
      expect(events.filter((event) => event.type === 'steer')).toHaveLength(consumed ? 1 : 0);
      expect(events.at(-1)?.type).toBe('done');
    } finally {
      await handle.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

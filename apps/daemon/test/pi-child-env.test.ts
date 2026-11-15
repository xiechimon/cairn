import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { delimiter, join } from 'node:path';
import type { SessionOpts } from '@cairn/shared';
import { createAgentSession } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test, vi } from 'vitest';
import { daemonOtelFromEnv } from '../src/backend/otel.js';
import { createPiBackend } from '../src/backend/pi.js';
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
      expect(child.OTEL_SDK_DISABLED).toBe('true');
      expect(child).toMatchObject({
        PATH: `${join(directory, 'agent', 'bin')}${delimiter}${path}`,
        HOME: directory,
        FOO: env?.FOO ?? 'daemon-value',
      });
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
    expect(child.PI_TELEMETRY).toBe('operator-choice');
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

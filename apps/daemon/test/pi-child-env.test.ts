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

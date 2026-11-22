import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderConfig, SessionOpts } from '@cairn/shared';
import { COORDINATOR_COMPACT_AT } from '@cairn/shared';
import { createAgentSession, type SettingsManager } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { createPiBackend, piHostLaunch } from '../src/backend/pi.js';
import { openPiHostSession } from '../src/backend/pi-host-client.js';
import { PI_HOST_PROTOCOL_VERSION } from '../src/backend/pi-host-protocol.js';
import { testTempDir } from './test-temp-dir.js';

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>();
  return { ...actual, createAgentSession: vi.fn(actual.createAgentSession) };
});

const MAIN_RESERVE_TOKENS = 16_384;
const MAIN_KEEP_RECENT_TOKENS = 20_000;

function sessionOpts(
  directory: string,
  provider: ProviderConfig,
  modelId: string,
  compactAt?: number,
): SessionOpts {
  return {
    cwd: directory,
    provider,
    modelId,
    ...(compactAt === undefined ? {} : { compactAt }),
  };
}

function listedProvider(providerId: string, models: ProviderConfig['models']): ProviderConfig {
  return {
    kind: 'http',
    providerId,
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    ...(models === undefined ? {} : { models }),
  };
}

async function openSession(directory: string, opts: SessionOpts) {
  const backend = createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
  });
  return backend.createSession(opts);
}

function sessionSettings(): {
  settings: SettingsManager;
  model: { provider: string; id: string; contextWindow: number };
} {
  const options = vi.mocked(createAgentSession).mock.calls.at(-1)?.[0];
  if (options?.settingsManager === undefined || options.model === undefined) {
    throw new Error('createAgentSession did not receive a settings manager and model');
  }
  return { settings: options.settingsManager, model: options.model };
}

test('a listed model with no declared window compacts at the coordinator point', async () => {
  const directory = testTempDir('pi-compact-at-listed-');
  const handle = await openSession(
    directory,
    sessionOpts(
      directory,
      listedProvider('deepseek', [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }]),
      'deepseek-v4-pro',
      COORDINATOR_COMPACT_AT,
    ),
  );
  try {
    const { settings, model } = sessionSettings();
    expect(model.contextWindow).toBe(1_000_000);
    const resolved = settings.getCompactionSettings(model);
    expect(1_000_000 - resolved.reserveTokens).toBe(COORDINATOR_COMPACT_AT);
  } finally {
    await handle.stop();
  }
});

test('a built-in model declared wider than it resolves keeps a positive threshold', async () => {
  const directory = testTempDir('pi-compact-at-builtin-');
  const handle = await openSession(
    directory,
    sessionOpts(
      directory,
      listedProvider('zai', [
        { id: 'glm-5-turbo', name: 'GLM 5 Turbo', contextWindow: 1_000_000, maxTokens: 16_384 },
      ]),
      'glm-5-turbo',
      COORDINATOR_COMPACT_AT,
    ),
  );
  try {
    const { settings, model } = sessionSettings();
    expect(model.contextWindow).toBe(200_000);
    const resolved = settings.getCompactionSettings(model);
    expect(200_000 - resolved.reserveTokens).toBe(COORDINATOR_COMPACT_AT);
    expect(resolved.reserveTokens).toBeGreaterThan(0);
  } finally {
    await handle.stop();
  }
});

test('a switch to a model outside the provider list compacts at the coordinator point', async () => {
  const directory = testTempDir('pi-compact-at-switch-');
  const handle = await openSession(
    directory,
    sessionOpts(
      directory,
      listedProvider('deepseek', [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }]),
      'deepseek-v4-pro',
      COORDINATOR_COMPACT_AT,
    ),
  );
  try {
    const { settings } = sessionSettings();
    const switched = settings.getCompactionSettings({ provider: 'deepseek', id: 'deepseek-flash' });
    expect(1_000_000 - switched.reserveTokens).toBe(COORDINATOR_COMPACT_AT);
  } finally {
    await handle.stop();
  }
});

test('a window at or below compactAt never reserves below what that model gets on main', async () => {
  const directory = testTempDir('pi-compact-at-small-');
  const handle = await openSession(
    directory,
    sessionOpts(
      directory,
      listedProvider('synthetic', [
        { id: 'synthetic', name: 'Synthetic', contextWindow: 32_000, maxTokens: 16_384 },
      ]),
      'synthetic',
      COORDINATOR_COMPACT_AT,
    ),
  );
  try {
    const { settings, model } = sessionSettings();
    const resolved = settings.getCompactionSettings(model);
    expect(resolved.reserveTokens).toBe(MAIN_RESERVE_TOKENS);
    expect(32_000 - resolved.reserveTokens).toBe(15_616);
  } finally {
    await handle.stop();
  }
});

test('a worker session without compactAt keeps origin/main compaction settings', async () => {
  const directory = testTempDir('pi-compact-at-worker-');
  const handle = await openSession(
    directory,
    sessionOpts(
      directory,
      listedProvider('deepseek', [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }]),
      'deepseek-v4-pro',
    ),
  );
  try {
    const { settings, model } = sessionSettings();
    expect(settings.getCompactionSettings(model)).toEqual({
      enabled: true,
      reserveTokens: MAIN_RESERVE_TOKENS,
      keepRecentTokens: MAIN_KEEP_RECENT_TOKENS,
    });
    expect(settings.getSettings().compaction?.modelOverrides).toBeUndefined();
  } finally {
    await handle.stop();
  }
});

test('the pi host wire carries compactAt to the confined child session', async () => {
  const directory = testTempDir('pi-compact-at-host-');
  const probe = join(directory, 'probe', 'session.json');
  const hostScript = join(directory, 'host.mjs');
  mkdirSync(join(directory, 'agent'), { recursive: true });
  mkdirSync(join(directory, 'sessions'), { recursive: true });
  mkdirSync(join(directory, 'probe'), { recursive: true });
  writeFileSync(
    hostScript,
    [
      `import { writeFileSync } from 'node:fs';`,
      `import { join } from 'node:path';`,
      `let buffer = '';`,
      `const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');`,
      `process.stdin.on('data', (data) => {`,
      `  buffer += data;`,
      `  let index;`,
      `  while ((index = buffer.indexOf('\\n')) !== -1) {`,
      `    const frame = JSON.parse(buffer.slice(0, index));`,
      `    buffer = buffer.slice(index + 1);`,
      `    if (frame.t === 'initialize') {`,
      `      const file = join(frame.sessionDir, 'session.jsonl');`,
      `      writeFileSync(file, '');`,
      `      writeFileSync(${JSON.stringify(probe)}, JSON.stringify(frame.session));`,
      `      send({ t: 'ready', v: ${PI_HOST_PROTOCOL_VERSION}, sessionId: 'sid', sessionFile: file });`,
      `      send({ t: 'ended' });`,
      `    }`,
      `  }`,
      `});`,
      `process.stdin.on('end', () => process.exit(0));`,
    ].join('\n'),
  );
  const handle = await openPiHostSession({
    backend: {
      agentDir: join(directory, 'agent'),
      sessionDir: join(directory, 'sessions'),
    },
    confine: (_opts, _harness, launch) => launch,
    launch: piHostLaunch(hostScript),
    opts: sessionOpts(
      directory,
      listedProvider('synthetic', [
        { id: 'synthetic', name: 'Synthetic', contextWindow: 1_000_000, maxTokens: 16_384 },
      ]),
      'synthetic',
      COORDINATOR_COMPACT_AT,
    ),
    resumeFile: null,
  });
  await handle.stop();
  const sent = JSON.parse(readFileSync(probe, 'utf8')) as { compactAt?: number };
  expect(sent.compactAt).toBe(COORDINATOR_COMPACT_AT);
});

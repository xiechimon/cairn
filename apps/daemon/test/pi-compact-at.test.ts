import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionOpts } from '@cairn/shared';
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

const UPSTREAM_RESERVE_TOKENS = 16_384;
const UPSTREAM_KEEP_RECENT_TOKENS = 20_000;

function sessionOpts(directory: string, contextWindow: number): SessionOpts {
  return {
    cwd: directory,
    compactAt: COORDINATOR_COMPACT_AT,
    provider: {
      kind: 'http',
      providerId: 'synthetic',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      models: [{ id: 'synthetic', name: 'Synthetic', contextWindow, maxTokens: 16_384 }],
    },
    modelId: 'synthetic',
  };
}

async function openSession(directory: string, opts: SessionOpts) {
  const backend = createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
  });
  return backend.createSession(opts);
}

function lastSessionSettings(): {
  settings: SettingsManager;
  model: { provider: string; id: string };
} {
  const options = vi.mocked(createAgentSession).mock.calls.at(-1)?.[0];
  if (options?.settingsManager === undefined || options.model === undefined) {
    throw new Error('createAgentSession did not receive a settings manager and model');
  }
  return { settings: options.settingsManager, model: options.model };
}

test('a 1M-window Coordinator session compacts at the coordinator point, not near the window', async () => {
  const directory = testTempDir('pi-compact-at-1m-');
  const handle = await openSession(directory, sessionOpts(directory, 1_000_000));
  try {
    const { settings, model } = lastSessionSettings();
    const resolved = settings.getCompactionSettings(model);
    expect(resolved.reserveTokens).toBe(1_000_000 - COORDINATOR_COMPACT_AT);
    expect(1_000_000 - resolved.reserveTokens).toBe(COORDINATOR_COMPACT_AT);
    const other = settings.getCompactionSettings({ provider: 'other', id: 'other' });
    expect(other.reserveTokens).toBe(UPSTREAM_RESERVE_TOKENS);
    expect(1_000_000 - other.reserveTokens).toBe(983_616);
    const summary = settings.getCompactionSettings();
    expect(summary.reserveTokens).toBe(UPSTREAM_RESERVE_TOKENS);
    expect(summary.enabled).toBe(true);
    expect(summary.keepRecentTokens).toBe(UPSTREAM_KEEP_RECENT_TOKENS);
  } finally {
    await handle.stop();
  }
});

test('a small-window Coordinator session never compacts past the window', async () => {
  const directory = testTempDir('pi-compact-at-small-');
  const handle = await openSession(directory, sessionOpts(directory, 32_000));
  try {
    const { settings, model } = lastSessionSettings();
    const resolved = settings.getCompactionSettings(model);
    expect(resolved.reserveTokens).toBe(UPSTREAM_RESERVE_TOKENS);
    expect(32_000 - resolved.reserveTokens).toBe(15_616);
    expect(32_000 - resolved.reserveTokens).toBeLessThan(COORDINATOR_COMPACT_AT);
    expect(resolved.reserveTokens).toBeGreaterThan(0);
  } finally {
    await handle.stop();
  }
});

test('a session without compactAt keeps the upstream compaction settings untouched', async () => {
  const directory = testTempDir('pi-compact-at-worker-');
  const opts = sessionOpts(directory, 1_000_000);
  delete (opts as Partial<SessionOpts>).compactAt;
  const handle = await openSession(directory, opts);
  try {
    const { settings, model } = lastSessionSettings();
    const resolved = settings.getCompactionSettings(model);
    expect(resolved).toEqual({
      enabled: true,
      reserveTokens: UPSTREAM_RESERVE_TOKENS,
      keepRecentTokens: UPSTREAM_KEEP_RECENT_TOKENS,
    });
    expect(settings.getSettings().compaction?.modelOverrides).toBeUndefined();
  } finally {
    await handle.stop();
  }
});

test('a window just above compactAt never reserves less than the model gets on main', async () => {
  const directory = testTempDir('pi-compact-at-160k-');
  const handle = await openSession(directory, sessionOpts(directory, 160_000));
  try {
    const { settings, model } = lastSessionSettings();
    const resolved = settings.getCompactionSettings(model);
    expect(160_000 - resolved.reserveTokens).toBeLessThanOrEqual(COORDINATOR_COMPACT_AT);
    expect(resolved.reserveTokens).toBeGreaterThanOrEqual(
      settings.getCompactionSettings().reserveTokens,
    );
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
    opts: sessionOpts(directory, 1_000_000),
    resumeFile: null,
  });
  await handle.stop();
  const sent = JSON.parse(readFileSync(probe, 'utf8')) as { compactAt?: number };
  expect(sent.compactAt).toBe(COORDINATOR_COMPACT_AT);
});

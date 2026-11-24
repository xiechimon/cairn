import { join } from 'node:path';
import type { ProviderConfig, SessionOpts } from '@cairn/shared';
import { COORDINATOR_COMPACT_AT } from '@cairn/shared';
import {
  createAgentSession,
  type SettingsManager,
  shouldCompact,
} from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { createPiBackend, daemonSettingsManager } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>();
  return { ...actual, createAgentSession: vi.fn(actual.createAgentSession) };
});

const MAIN_RESERVE_TOKENS = 16_384;
const MAIN_KEEP_RECENT_TOKENS = 20_000;

interface RuntimeModel {
  provider: string;
  id: string;
  contextWindow: number;
  api: string;
}

function runtimeModel(
  provider: string,
  id: string,
  contextWindow: number,
  api = 'openai-completions',
): RuntimeModel {
  return { provider, id, contextWindow, api };
}

function coordinatorSettings(): SettingsManager {
  return daemonSettingsManager({ compactAt: COORDINATOR_COMPACT_AT });
}

function compacts(
  settings: SettingsManager,
  model: { provider: string; id: string; contextWindow: number },
  tokens: number,
): boolean {
  return shouldCompact(tokens, model.contextWindow, settings.getCompactionSettings(model));
}

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

test('a listed model with no declared window compacts exactly at the coordinator point', async () => {
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
    expect(compacts(settings, model, COORDINATOR_COMPACT_AT - 1)).toBe(false);
    expect(compacts(settings, model, COORDINATOR_COMPACT_AT)).toBe(true);
    expect(settings.getCompactionSettings(model).keepRecentTokens).toBe(MAIN_KEEP_RECENT_TOKENS);
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
    expect(settings.getCompactionSettings(model).reserveTokens).toBeGreaterThan(0);
    expect(compacts(settings, model, COORDINATOR_COMPACT_AT - 1)).toBe(false);
    expect(compacts(settings, model, COORDINATOR_COMPACT_AT)).toBe(true);
  } finally {
    await handle.stop();
  }
});

test('a switch to a model outside the provider list compacts exactly at the coordinator point', () => {
  const settings = coordinatorSettings();
  const switched = runtimeModel('deepseek', 'deepseek-flash', 1_000_000);
  expect(compacts(settings, switched, COORDINATOR_COMPACT_AT - 1)).toBe(false);
  expect(compacts(settings, switched, COORDINATOR_COMPACT_AT)).toBe(true);
  expect(settings.getCompactionSettings(switched).keepRecentTokens).toBe(MAIN_KEEP_RECENT_TOKENS);
});

test('a model re-registered narrower under the same provider and id compacts for the new window', () => {
  const settings = coordinatorSettings();
  const wide = runtimeModel('deepseek', 'deepseek-v4-pro', 1_000_000);
  const narrow = runtimeModel('deepseek', 'deepseek-v4-pro', 200_000);
  expect(compacts(settings, wide, COORDINATOR_COMPACT_AT - 1)).toBe(false);
  expect(compacts(settings, wide, COORDINATOR_COMPACT_AT)).toBe(true);
  expect(compacts(settings, narrow, COORDINATOR_COMPACT_AT - 1)).toBe(false);
  expect(compacts(settings, narrow, COORDINATOR_COMPACT_AT)).toBe(true);
});

test('two models whose flattened keys collide each compact for their own window', () => {
  const settings = coordinatorSettings();
  const large = runtimeModel('a/b', 'c', 1_000_000);
  const small = runtimeModel('a', 'b/c', 32_000);
  expect(compacts(settings, large, COORDINATOR_COMPACT_AT - 1)).toBe(false);
  expect(compacts(settings, large, COORDINATOR_COMPACT_AT)).toBe(true);
  expect(settings.getCompactionSettings(small).reserveTokens).toBe(MAIN_RESERVE_TOKENS);
  expect(compacts(settings, small, 15_616)).toBe(false);
  expect(compacts(settings, small, 15_617)).toBe(true);
});

test('a fractional window compacts exactly at the coordinator point', () => {
  const settings = coordinatorSettings();
  const fractional = runtimeModel('synthetic', 'fractional', 200_000.5);
  expect(compacts(settings, fractional, COORDINATOR_COMPACT_AT - 1)).toBe(false);
  expect(compacts(settings, fractional, COORDINATOR_COMPACT_AT)).toBe(true);
});

test('an oversized finite window keeps the cap instead of the base reserve', () => {
  const settings = coordinatorSettings();
  const oversized = runtimeModel('synthetic', 'oversized', 1e16);
  const resolved = settings.getCompactionSettings(oversized);
  const cutoff = 1e16 - resolved.reserveTokens;
  expect(resolved.reserveTokens).toBeGreaterThan(MAIN_RESERVE_TOKENS);
  expect(cutoff).toBeGreaterThanOrEqual(COORDINATOR_COMPACT_AT - 1);
  expect(cutoff).toBeLessThanOrEqual(COORDINATOR_COMPACT_AT + 1);
  expect(compacts(settings, oversized, COORDINATOR_COMPACT_AT + 1)).toBe(true);
});

test('a 160K window keeps the earlier base trigger', () => {
  const settings = coordinatorSettings();
  const model = runtimeModel('synthetic', 'narrow', 160_000);
  const baseTrigger = 160_000 - MAIN_RESERVE_TOKENS;
  expect(settings.getCompactionSettings(model).reserveTokens).toBe(MAIN_RESERVE_TOKENS);
  expect(compacts(settings, model, baseTrigger)).toBe(false);
  expect(compacts(settings, model, baseTrigger + 1)).toBe(true);
  expect(baseTrigger + 1).toBeLessThan(COORDINATOR_COMPACT_AT);
});

test('a virtual model keeps the base reserve', () => {
  const settings = coordinatorSettings();
  const virtual = runtimeModel('radius', 'balanced', 1_048_576, 'pi-virtual');
  expect(settings.getCompactionSettings(virtual).reserveTokens).toBe(MAIN_RESERVE_TOKENS);
  expect(compacts(settings, virtual, COORDINATOR_COMPACT_AT)).toBe(false);
});

test('no model or no finite window keeps the base reserve', () => {
  const settings = coordinatorSettings();
  expect(settings.getCompactionSettings().reserveTokens).toBe(MAIN_RESERVE_TOKENS);
  expect(
    settings.getCompactionSettings(runtimeModel('synthetic', 'infinite', Number.POSITIVE_INFINITY))
      .reserveTokens,
  ).toBe(MAIN_RESERVE_TOKENS);
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
    expect(settings.getCompactionSettings(model).reserveTokens).toBe(MAIN_RESERVE_TOKENS);
    expect(compacts(settings, model, 15_616)).toBe(false);
    expect(compacts(settings, model, 15_617)).toBe(true);
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

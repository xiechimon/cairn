import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { ClaudeCodeBackend } from '../src/backend/claude-code.js';
import { probeModelImageSupport, rememberNoVision } from '../src/backend/image-support.js';

function customProvider(providerId: string, models: ProviderConfig['models']): ProviderConfig {
  return {
    kind: 'http',
    providerId,
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    models,
  };
}

function builtinProvider(providerId: string): ProviderConfig {
  return { kind: 'api_key', providerId };
}

describe('probeModelImageSupport decision order (#1671)', () => {
  test('Claude Code reuses an observed image rejection for the next step', async () => {
    const backend = new ClaudeCodeBackend({});
    const provider = builtinProvider('claude-code');
    await expect(backend.modelSupportsImages(provider, 'text-relay')).resolves.toBeNull();
    backend.rememberNoVision(provider, 'text-relay');
    await expect(backend.modelSupportsImages(provider, 'text-relay')).resolves.toBe(false);
  });
  test('custom model declares input [text,image] → true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    const provider = customProvider('vision-gw', [
      { id: 'glm-5v', name: 'glm-5v', input: ['text', 'image'] },
    ]);
    await expect(probeModelImageSupport(dir, provider, 'glm-5v')).resolves.toBe(true);
  });

  test('custom model declares input [text] → false (degrade without paying a 400 first)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    const provider = customProvider('text-gw', [{ id: 'm1', name: 'M1', input: ['text'] }]);
    await expect(probeModelImageSupport(dir, provider, 'm1')).resolves.toBe(false);
  });

  test('custom model input undeclared → null (unknown keeps today force-delivery behavior, the #1671 regression red line)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    const provider = customProvider('undecl-gw', [{ id: 'm2', name: 'M2' }]);
    await expect(probeModelImageSupport(dir, provider, 'm2')).resolves.toBe(null);
  });

  test('custom model absent from the declared list → null (no declaration, no guess)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    const provider = customProvider('absent-gw', [{ id: 'listed', name: 'Listed' }]);
    await expect(probeModelImageSupport(dir, provider, 'not-listed')).resolves.toBe(null);
  });

  test('builtin model with bundled image input → true (anthropic claude-sonnet-4-5)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    await expect(
      probeModelImageSupport(dir, builtinProvider('anthropic'), 'claude-sonnet-4-5'),
    ).resolves.toBe(true);
  });

  test('builtin model unknown to the runtime → null (not-found is unknown, not false)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    await expect(
      probeModelImageSupport(dir, builtinProvider('no-such-provider'), 'no-such-model'),
    ).resolves.toBe(null);
  });

  test('learned no-vision overrides a vision declaration (measured 400 beats metadata)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    const provider = customProvider('lying-gw', [
      { id: 'm3', name: 'M3', input: ['text', 'image'] },
    ]);
    await expect(probeModelImageSupport(dir, provider, 'm3')).resolves.toBe(true);
    rememberNoVision('lying-gw', 'm3');
    await expect(probeModelImageSupport(dir, provider, 'm3')).resolves.toBe(false);
  });

  test('learned no-vision is per model, not per provider (no cross-model bleed)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-imgprobe-'));
    const provider = customProvider('permodel-gw', [
      { id: 'm4', name: 'M4', input: ['text', 'image'] },
      { id: 'm5', name: 'M5', input: ['text', 'image'] },
    ]);
    rememberNoVision('permodel-gw', 'm4');
    await expect(probeModelImageSupport(dir, provider, 'm4')).resolves.toBe(false);
    await expect(probeModelImageSupport(dir, provider, 'm5')).resolves.toBe(true);
  });
});

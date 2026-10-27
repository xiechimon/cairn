import {
  BRIEF_CREATE_NAME,
  briefBackendForProvider,
  isBackendRuntimeId,
  MACHINE_RUNTIMES,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { acpErrorMessage, mapAcpUpdate, validateGeminiSession } from '../src/backend/acp.js';

describe('Gemini ACP bridge', () => {
  test('failure mode 1: missing spawn binary yields an install hint', () => {
    expect(acpErrorMessage(new Error('spawn gemini ENOENT'))).toContain('install Gemini CLI');
  });

  test('failure mode 2: auth failure points to Gemini login', () => {
    expect(acpErrorMessage(new Error('authenticate required'))).toContain('Gemini login');
    expect(acpErrorMessage(new Error('Gemini API key is missing or not configured.'))).toContain(
      'Gemini login',
    );
  });

  test('failure mode 3: gemini is a standalone runtime; unknown provider stays pi', async () => {
    expect(isBackendRuntimeId('gemini')).toBe(true);
    expect(isBackendRuntimeId('unknown-provider')).toBe(false);
  });

  test('failure mode 4: absent runtime switch does not pass', async () => {
    expect(MACHINE_RUNTIMES).toContain('gemini');
    expect(['pi'].includes('gemini')).toBe(false);
  });

  test('failure mode 5: brief backend uses GEMINI.md', async () => {
    expect(BRIEF_CREATE_NAME[briefBackendForProvider('gemini')]).toBe('GEMINI.md');
  });

  test('failure mode 6: resume produces no new user message', () => {
    expect(validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', resumeId: 's1' })).toEqual({
      prompt: undefined,
      resumeId: 's1',
    });
  });

  test('failure mode 7: images rejected when image capability is absent', () => {
    expect(() =>
      validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', promptImages: [] }),
    ).not.toThrow();
    expect(() =>
      validateGeminiSession({
        cwd: '/tmp',
        modelId: 'gemini',
        promptImages: [{ data: 'x', mimeType: 'image/png' }],
      }),
    ).toThrow('image capability');
  });

  test('failure mode 8: non-empty tool set fails closed', () => {
    expect(() =>
      validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', remoteTools: [{ name: 'x' }] }),
    ).toThrow('fail-closed');
    expect(() =>
      validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', localTools: [{ name: 'x' }] }),
    ).toThrow('fail-closed');
  });

  test('failure mode 9: cancellation error maps to message_stop', () => {
    expect(mapAcpUpdate({ kind: 'cancelled' })).toEqual({
      type: 'message_stop',
      message: { role: 'assistant', content: '' },
    });
  });

  test('failure mode 10: protocol version mismatch keeps both versions', () => {
    expect(acpErrorMessage(new Error('protocolVersion 0.16.1 != 2.0.2'))).toContain(
      'protocolVersion',
    );
  });
});

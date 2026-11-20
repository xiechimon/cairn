import { describe, expect, test } from 'vitest';
import {
  antigravityKeyFromText,
  createAntigravitySubscriptionSchema,
  DEFAULT_ANTIGRAVITY_MODELS,
  managedVersionedBins,
} from '../src/index.js';

describe('antigravity local helpers and schemas', () => {
  test('parses raw token, env export, and JSON credentials while rejecting junk', () => {
    const token = 'AIzaSyA1234567890_ValidTokenValue';
    expect(antigravityKeyFromText(token)).toBe(token);
    expect(antigravityKeyFromText(`export GEMINI_API_KEY="${token}"`)).toBe(token);
    expect(antigravityKeyFromText(`GEMINI_API_KEY='${token}'`)).toBe(token);
    expect(antigravityKeyFromText(JSON.stringify({ GEMINI_API_KEY: token }))).toBe(token);
    expect(antigravityKeyFromText(JSON.stringify({ apiKey: token }))).toBe(token);
    expect(antigravityKeyFromText('')).toBeNull();
    expect(antigravityKeyFromText('short')).toBeNull();
    expect(antigravityKeyFromText('{bad')).toBeNull();
  });

  test('managedVersionedBins sorts newest version first across the bin names', () => {
    const candidates = managedVersionedBins(
      '/cairn/tools/antigravity/versions',
      ['1.0.0', '1.5.10'],
      ['bin/antigravity-acp', 'bin/agy'],
    );
    expect(candidates).toEqual([
      '/cairn/tools/antigravity/versions/1.5.10/bin/antigravity-acp',
      '/cairn/tools/antigravity/versions/1.5.10/bin/agy',
      '/cairn/tools/antigravity/versions/1.0.0/bin/antigravity-acp',
      '/cairn/tools/antigravity/versions/1.0.0/bin/agy',
    ]);
  });

  test('createAntigravitySubscriptionSchema accepts host-login (null/omitted token) and validates token when set', () => {
    expect(createAntigravitySubscriptionSchema.parse({ label: 'Local Keyring' })).toEqual({
      label: 'Local Keyring',
    });
    expect(
      createAntigravitySubscriptionSchema.parse({ label: 'Local Keyring', token: null }),
    ).toEqual({
      label: 'Local Keyring',
      token: null,
    });
    expect(
      createAntigravitySubscriptionSchema.parse({
        label: 'API Key',
        token: 'AIzaSyA1234567890_ValidTokenValue',
      }).token,
    ).toBe('AIzaSyA1234567890_ValidTokenValue');
    expect(() =>
      createAntigravitySubscriptionSchema.parse({ label: 'Bad', token: 'too-short' }),
    ).toThrow();
  });

  test('DEFAULT_ANTIGRAVITY_MODELS includes all 9 observed models', () => {
    expect(DEFAULT_ANTIGRAVITY_MODELS.map((m) => m.id)).toEqual([
      'gemini-4-carbon',
      'gemini-4-argon',
      'gemini-4-hydrogen',
      'gemini-pro-orchestrator',
      'gemini-pro-orchestrator-argon',
      'gemini-3.8-flash',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ]);
  });
});

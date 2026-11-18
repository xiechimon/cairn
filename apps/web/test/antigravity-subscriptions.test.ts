import { describe, expect, test } from 'vitest';
import { extractAntigravityToken } from '../src/api/antigravity-subscriptions.js';

describe('extractAntigravityToken', () => {
  test('returns a bare token unchanged', () => {
    expect(extractAntigravityToken('  AIzaSyRealKey1234567890  ')).toBe('AIzaSyRealKey1234567890');
  });

  test('pulls GEMINI_API_KEY out of a pasted .env snippet', () => {
    const snippet = 'FOO=bar\nexport GEMINI_API_KEY="AIzaSyEnvKey1234567890"\nBAZ=1';
    expect(extractAntigravityToken(snippet)).toBe('AIzaSyEnvKey1234567890');
  });

  test('pulls apiKey from a pasted JSON object', () => {
    expect(extractAntigravityToken('{"apiKey":"AIzaSyJsonKey1234567890"}')).toBe(
      'AIzaSyJsonKey1234567890',
    );
  });

  test('leaves unrelated text untouched for server validation', () => {
    expect(extractAntigravityToken('short')).toBe('short');
  });
});

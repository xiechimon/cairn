import { describe, expect, test } from 'vitest';
import { extractDevinToken } from '../src/api/devin-subscriptions.js';

describe('extractDevinToken', () => {
  test('returns a bare token unchanged', () => {
    expect(extractDevinToken('  wsk-abc123  ')).toBe('wsk-abc123');
  });

  test('pulls windsurf_api_key out of a pasted credentials.toml', () => {
    const toml = [
      'windsurf_api_key = "wsk-real-key"',
      'api_server_url = "https://server.codeium.com"',
      'devin_webapp_host = "https://app.devin.ai"',
      'devin_api_url = "https://api.devin.ai"',
    ].join('\n');
    expect(extractDevinToken(toml)).toBe('wsk-real-key');
  });

  test('handles the key appearing after other entries', () => {
    const toml = 'api_server_url = "https://x"\nwindsurf_api_key = "wsk-late"\ndevin_api_url = "https://y"';
    expect(extractDevinToken(toml)).toBe('wsk-late');
  });

  test('leaves unrelated multi-line text untouched', () => {
    expect(extractDevinToken('line one\nline two')).toBe('line one\nline two');
  });
});

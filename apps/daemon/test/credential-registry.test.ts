import type { StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  CredentialRegistry,
  credentialRedactor,
  credentialSafeEvents,
} from '../src/credential-output.js';

describe('step credential registry', () => {
  test('deduplicates live secrets, expires plaintext and clears on cleanup', () => {
    let now = 100;
    const registry = new CredentialRegistry(() => now, 2);
    try {
      registry.remember('live', 200);
      registry.remember('live', 300);
      registry.remember('brief', 150);
      expect(registry.values()).toEqual(['live', 'brief']);
      expect(registry.redact({ output: 'live brief' })).toEqual({
        output: '[REDACTED] [REDACTED]',
      });
      now = 160;
      expect(registry.values()).toEqual(['live']);
      registry.remember('next', 250);
      expect(() => registry.remember('excess', 400)).toThrow('capacity');
      expect(registry.redact('live next')).toBe('[REDACTED] [REDACTED]');
      now = 301;
      expect(registry.values()).toEqual([]);
      registry.remember('last', 500);
      registry.dispose();
      expect(registry.values()).toEqual([]);
      expect(() => registry.remember('late', 600)).toThrow('disposed');
    } finally {
      registry.dispose();
    }
  });

  test('historical GitHub installation tokens redact without retaining their plaintext', async () => {
    const token = `ghs_${'a'.repeat(36)}`;
    expect(credentialRedactor()(`old ${token}`)).toBe('old [REDACTED]');
    for (let split = 1; split < token.length; split++) {
      async function* source(): AsyncGenerator<StepEvent> {
        yield { type: 'text_delta', text: token.slice(0, split) };
        yield { type: 'text_delta', text: token.slice(split) };
        yield { type: 'done', usage: [] };
      }
      const chunks: string[] = [];
      for await (const event of credentialSafeEvents(source(), () => [])) {
        if (event.type === 'text_delta') chunks.push(event.text);
      }
      expect(chunks.join('')).toBe('[REDACTED]');
    }
  });
});

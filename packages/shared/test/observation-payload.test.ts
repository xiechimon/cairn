import { expect, test } from 'vitest';
import { observationAttributes } from '../src/genai-conventions.js';

test('uses deployed Langfuse observation keys and preserves message roles and content', () => {
  const input = [{ role: 'user', content: 'hello' }];
  const output = { role: 'assistant', content: [{ type: 'text', text: 'hi' }] };
  expect(observationAttributes({ input, output })).toEqual({
    'langfuse.observation.input': JSON.stringify(input),
    'langfuse.observation.output': JSON.stringify(output),
  });
  expect(observationAttributes({})).toEqual({});
});

test('redacts structured credentials before serializing input and output', () => {
  const secret = `sk-${'a'.repeat(30)}`;
  const attrs = observationAttributes({
    input: [{ role: 'user', content: `use ${secret}`, token: 'private-value' }],
    output: { role: 'assistant', content: { authorization: 'private-value' } },
  });
  const wire = JSON.stringify(attrs);
  expect(wire).not.toContain(secret);
  expect(wire).not.toContain('private-value');
  expect(wire).toContain('[REDACTED]');
});

test('caps unicode payloads at 32 KiB and retains the latest conversation messages as valid JSON', () => {
  const input = Array.from({ length: 40 }, (_, index) => ({
    role: 'user',
    content: `${index} ${'😀'.repeat(10_000)}`,
  }));
  const attrs = observationAttributes({ input, output: '\u0000'.repeat(100_000) });
  for (const value of Object.values(attrs)) {
    expect(typeof value).toBe('string');
    expect(Buffer.byteLength(String(value))).toBeLessThanOrEqual(32_768);
    expect(() => JSON.parse(String(value))).not.toThrow();
  }
  const messages = JSON.parse(String(attrs['langfuse.observation.input']));
  expect(messages).toHaveLength(16);
  expect(messages.at(-1).role).toBe('user');
  expect(messages.at(-1).content).toContain('39 ');
  expect(messages.at(-1).content).toContain('[truncated]');
});

import type { StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { credentialRedactor, credentialSafeEvents } from '../src/credential-output.js';

async function collect(events: StepEvent[], token?: string): Promise<StepEvent[]> {
  const output: StepEvent[] = [];
  async function* source() {
    yield* events;
  }
  for await (const event of credentialSafeEvents(source(), token)) output.push(event);
  return output;
}

describe('subscription output redaction', () => {
  const token = 'private-step-subscription-token';
  test('every streaming split masks the entire token without changing surrounding text', async () => {
    const original = `prefix ${token} middle ${token} suffix`;
    for (let split = 1; split < original.length; split++) {
      const events = await collect(
        [
          { type: 'text_delta', text: original.slice(0, split) },
          { type: 'text_delta', text: original.slice(split) },
          { type: 'done', usage: [] },
        ],
        token,
      );
      const text = events
        .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
        .join('');
      expect(text).toBe('prefix [REDACTED] middle [REDACTED] suffix');
    }
  });
  test('thinking, tool arguments, nested results and errors cannot disclose the token', async () => {
    const output = await collect(
      [
        { type: 'thinking_delta', text: token.slice(0, 8) },
        { type: 'thinking_delta', text: token.slice(8) },
        {
          type: 'toolcall_end',
          call: {
            id: 'tool',
            name: 'bash',
            arguments: { command: token },
            result: { nested: [token] },
          },
        },
        { type: 'error', error: { message: token, retryable: false } },
      ],
      token,
    );
    expect(JSON.stringify(output)).not.toContain(token);
    expect(JSON.stringify(output)).toContain('[REDACTED]');
  });
  test('uncredentialed events and non-secret values stay unchanged', async () => {
    const events: StepEvent[] = [
      { type: 'text_delta', text: 'normal output' },
      { type: 'done', usage: [] },
    ];
    expect(await collect(events)).toEqual(events);
    expect(credentialRedactor(token)({ count: 1, value: null, list: [true] })).toEqual({
      count: 1,
      value: null,
      list: [true],
    });
  });
});

test('rotated App credentials remain redacted across streaming chunk boundaries', async () => {
  const values = ['old-app-fixture'];
  const fresh = 'new-installation-fixture';
  async function* source(): AsyncGenerator<StepEvent> {
    yield { type: 'text_delta', text: values[0]! };
    values.push(fresh);
    yield { type: 'text_delta', text: fresh.slice(0, 7) };
    yield { type: 'text_delta', text: fresh.slice(7) };
    yield { type: 'done', usage: [] };
  }
  const output: StepEvent[] = [];
  for await (const event of credentialSafeEvents(source(), () => values)) output.push(event);
  const text = output
    .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
    .join('');
  expect(text).toBe('[REDACTED][REDACTED]');
});

test('dynamically refreshed Google OAuth tokens are redacted across every streaming split boundary with or without literal tokens', async () => {
  const initialRefresh = `1//0gInitialRefresh_${'r'.repeat(24)}`;
  const refreshedAccess = `ya29.${'z'.repeat(64)}`;
  for (const literal of [initialRefresh, undefined]) {
    const payload = `minted ${refreshedAccess} done`;
    for (let split = 1; split < payload.length; split++) {
      const events: StepEvent[] = [
        { type: 'text_delta', text: payload.slice(0, split) },
        { type: 'text_delta', text: payload.slice(split) },
        { type: 'done', usage: [] },
      ];
      const output: StepEvent[] = [];
      async function* source() {
        yield* events;
      }
      for await (const event of credentialSafeEvents(source(), literal)) output.push(event);
      const text = output
        .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
        .join('');
      expect(text).toBe('minted [REDACTED] done');
    }
  }
});

test('streaming boundary redaction stays linear and flushes incrementally on adversarial repeated Google OAuth prefixes', async () => {
  for (const unit of ['1//'.repeat(4), 'ya29.'.repeat(4)]) {
    const started = performance.now();
    async function* source(): AsyncGenerator<StepEvent> {
      for (let i = 0; i < 1200; i += 1) {
        yield { type: 'text_delta', text: unit };
      }
      yield { type: 'done', usage: [] };
    }
    const output: StepEvent[] = [];
    for await (const event of credentialSafeEvents(source(), undefined)) output.push(event);
    expect(performance.now() - started).toBeLessThan(500);
    const deltas = output.flatMap((event) => (event.type === 'text_delta' ? [event.text] : []));
    expect(deltas.length).toBeGreaterThan(5);
    const text = deltas.join('');
    expect(text).not.toContain('1//');
    expect(text).not.toContain('ya29.');
  }
});

test('long >4096-byte token-character filler cannot bypass streaming redaction of a subsequent split Google OAuth token', async () => {
  const realAccess = 'ya29.0123456789REAL_REFRESHED_ACCESS_TOKEN_SECRET_XYZ';
  const realRefresh = '1//0gREAL_REFRESH_TOKEN_SECRET_1234567890';
  const envelope = JSON.stringify({
    kind: 'oauth-personal',
    refreshToken: `1//0gEnvelope_${'e'.repeat(64)}`,
    authMethod: 'consumer',
  });
  const cases: { name: string; chunks: string[]; secret: string; literal?: string }[] = [
    {
      name: 'slash-separated ya29 after 4096-byte filler without literal',
      chunks: [`ya29.${'a'.repeat(4091)}`, `/${realAccess.slice(0, 15)}`, realAccess.slice(15)],
      secret: 'REAL_REFRESHED_ACCESS_TOKEN_SECRET_XYZ',
    },
    {
      name: 'slash-separated ya29 after 4096-byte filler with oauth envelope literal',
      chunks: [`ya29.${'a'.repeat(4091)}`, `/${realAccess.slice(0, 15)}`, realAccess.slice(15)],
      secret: 'REAL_REFRESHED_ACCESS_TOKEN_SECRET_XYZ',
      literal: envelope,
    },
    {
      name: '4096-byte filler directly before split ya29',
      chunks: [`${'a'.repeat(4096)}${realAccess.slice(0, 15)}`, realAccess.slice(15)],
      secret: 'REAL_REFRESHED_ACCESS_TOKEN_SECRET_XYZ',
    },
    {
      name: '4096-byte filler directly before split 1// refresh token',
      chunks: [`${'a'.repeat(4096)}${realRefresh.slice(0, 10)}`, realRefresh.slice(10)],
      secret: 'REFRESH_TOKEN_SECRET_1234567890',
    },
    {
      name: 'repeated 1// filler directly before split 1// refresh token',
      chunks: [`${'1//'.repeat(1366)}${realRefresh.slice(0, 10)}`, realRefresh.slice(10)],
      secret: 'REFRESH_TOKEN_SECRET_1234567890',
    },
    {
      name: '4100-byte filler before double-prefixed ya29 payload',
      chunks: [`${'a'.repeat(4100)}ya29.SECRET12345ya29.TAIL_67890`],
      secret: 'SECRET12345',
    },
    {
      name: '4100-byte filler before double-prefixed 1// payload',
      chunks: [`${'a'.repeat(4100)}1//SECRET_123456781//TAIL_1234567890`],
      secret: 'SECRET_12345678',
    },
    {
      name: 'short ya29 across delimiter before real ya29 + long tail does not leak crumb',
      chunks: [`ya29.abc xxya29.0123456789ya29.${'z'.repeat(4079)}`],
      secret: '0123456789',
    },
  ];
  for (const { name, chunks, secret, literal } of cases) {
    const events: StepEvent[] = [
      ...chunks.map((text): StepEvent => ({ type: 'text_delta', text })),
      { type: 'done', usage: [] },
    ];
    const output: StepEvent[] = [];
    async function* source() {
      yield* events;
    }
    for await (const event of credentialSafeEvents(source(), literal)) output.push(event);
    const text = output
      .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
      .join('');
    expect(text, name).not.toContain(secret);
    if (!name.startsWith('short ya29')) expect(text, name).not.toContain('ya29.');
    expect(text, name).not.toContain('1//');
  }
});

test('registered literal secrets containing embedded 1// or ya29. are never split or partially leaked', async () => {
  const literals = ['AbCdEfGhIj1//KlMnOpQrStUvWxYz012', 'my-secret-1//abc', 'my-secret-ya29.abc'];
  for (const secret of literals) {
    const payload = `auth=${secret}.suffix_${'x'.repeat(40)}`;
    const events: StepEvent[] = [
      { type: 'text_delta', text: payload },
      { type: 'done', usage: [] },
    ];
    const output: StepEvent[] = [];
    async function* source() {
      yield* events;
    }
    for await (const event of credentialSafeEvents(source(), secret)) output.push(event);
    const text = output
      .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
      .join('');
    expect(text).toBe(`auth=[REDACTED].suffix_${'x'.repeat(40)}`);
    expect(text).not.toContain(secret.slice(0, 8));
  }
});

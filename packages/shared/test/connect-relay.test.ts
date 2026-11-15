import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  parseRelayFrame,
  parseRelayResult,
  RELAY_FRAME_BYTES,
  RELAY_PAYLOAD_BYTES,
  relayBrowserFrameSchema,
  relayClientFrameSchema,
  relayControlFrameSchema,
  relayDescriptorSchema,
  relayHostFrameSchema,
  relayPairBodySchema,
  relayRequestSchema,
  serializeRelayFrame,
} from '../src/protocol/connect-relay.js';

const id = '5d2a6d62-f536-4b4c-9738-54b45d7b3459';
const connectionId = '6fbb89bb-a221-47e2-9bd1-012f41991b74';
const expiresAt = 1_800_000_000_000;
const token = 'ab'.repeat(32);
const pair = { code: 'aB_9'.repeat(8), name: 'phone' };
const requests = [
  { op: 'projects.list' },
  { op: 'coordinator.read', limit: 20, before: 'message-19' },
  { op: 'coordinator.send', projectId: 'project-1', content: 'hello', clientMessageId: id },
  { op: 'coordinator.watch' },
  { op: 'coordinator.stop' },
  { op: 'coordinator.answer', requestId: 'ask-1', answers: [{ header: 'choice', text: 'yes' }] },
  { op: 'coordinator.cancel', requestId: 'ask-2' },
] as const;
const message = {
  id: 'message-1',
  role: 'assistant',
  content: 'done',
  createdAt: expiresAt,
  projectId: null,
};
const values = [
  { projects: [{ id: 'project-1', name: 'project' }], hasMore: false },
  { threadId: 'thread-1', messages: [message], hasEarlier: true },
  { threadId: 'thread-1', messageId: 'message-2', replayed: false },
  { watching: true },
  { delegated: false },
  { answered: true },
  { cancelled: true },
];

test('pairing uses existing device names but admits only the exact relay code and fields', () => {
  expect(relayPairBodySchema.parse({ ...pair, name: '  phone  ' })).toEqual(pair);
  for (const code of ['', 'a'.repeat(31), 'a'.repeat(33), '+'.repeat(32)]) {
    expect(relayPairBodySchema.safeParse({ ...pair, code }).success).toBe(false);
  }
  expect(relayPairBodySchema.safeParse({ ...pair, owner: true }).success).toBe(false);
  expect(relayPairBodySchema.safeParse({ ...pair, name: ' ' }).success).toBe(false);
});

test('the seven requests are strict, including inherited answer exclusivity and nested fields', () => {
  for (const request of requests) {
    expect(relayRequestSchema.parse(request)).toEqual(request);
    expect(relayRequestSchema.safeParse({ ...request, teamId: 'another-team' }).success).toBe(
      false,
    );
  }
  expect(relayRequestSchema.safeParse({ op: 'fetch', path: '/api/secrets' }).success).toBe(false);
  const answer = requests[5];
  for (const entry of [
    { header: 'q' },
    { header: 'q', text: 'yes', choices: ['yes'] },
    { header: 'q', text: 'yes', answeredBy: 'person' },
    { header: 'q', choices: [] },
    { header: 'q', choices: Array(11).fill('yes') },
  ]) {
    expect(relayRequestSchema.safeParse({ ...answer, answers: [entry] }).success).toBe(false);
  }
  expect(
    relayRequestSchema.parse({ ...answer, answers: [{ header: 'q', choices: ['yes'] }] }),
  ).toBeTruthy();
  expect(
    relayRequestSchema.safeParse({ ...answer, answers: Array(11).fill(answer.answers[0]) }).success,
  ).toBe(false);
});

test('success validation is operation-specific, strictly projected and bounds expanded transcript rows', () => {
  for (const [i, request] of requests.entries()) {
    const result = { ok: true, value: values[i] };
    expect(parseRelayResult(request.op, result)).toEqual(result);
    expect(() =>
      parseRelayResult(request.op, { ok: true, value: values[(i + 1) % values.length] }),
    ).toThrow();
    expect(() => parseRelayResult(request.op, { ...result, trace: 'private' })).toThrow();
    expect(parseRelayResult(request.op, { ok: false, error: 'denied' })).toEqual({
      ok: false,
      error: 'denied',
    });
  }
  const page = { threadId: 'thread', messages: Array(20).fill(message), hasEarlier: false };
  expect(() => parseRelayResult('coordinator.read', { ok: true, value: page })).not.toThrow();
  for (const messages of [
    Array(21).fill(message),
    [{ ...message, content: { secret: 'no' } }],
    [{ ...message, token }],
  ]) {
    expect(() =>
      parseRelayResult('coordinator.read', { ok: true, value: { ...page, messages } }),
    ).toThrow();
  }
  expect(() =>
    parseRelayResult('projects.list', {
      ok: true,
      value: { projects: [{ id: 'p', name: 'p', path: '/private' }], hasMore: false },
    }),
  ).toThrow();
});

test('role-specific envelopes round-trip and reject cross-role, unknown fields and versions', () => {
  const common = { v: 1, id };
  const host = [
    { ...common, type: 'grant.put', digest: token, expiresAt },
    { ...common, type: 'paired', deviceId: 'phone', sessionToken: token, expiresAt },
    { ...common, type: 'admitted', connectionId, deviceId: 'phone', expiresAt },
    { ...common, type: 'admit.committed', connectionId },
    { v: 1, type: 'drop', connectionId },
    { ...common, type: 'result', result: { ok: true, value: values[0] } },
    { v: 1, type: 'changed', connectionId },
    { ...common, type: 'failed', error: 'denied' },
  ];
  const control = [
    { v: 1, type: 'host.ready', epoch: id, expiresAt },
    { ...common, type: 'grant.ack', ok: true },
    { ...common, type: 'pair', ...pair, deadlineAt: expiresAt },
    { ...common, type: 'admit', connectionId, sessionToken: token, deadlineAt: expiresAt },
    { ...common, type: 'admit.commit', connectionId, expiresAt },
    { v: 1, type: 'drop', connectionId },
    { ...common, type: 'call', connectionId, deadlineAt: expiresAt, request: requests[2] },
  ];
  const client = [{ v: 1, type: 'request', seq: 1, request: requests[0] }];
  const browser = [
    { v: 1, type: 'client.ready', connectionId, expiresAt },
    { v: 1, type: 'response', seq: 1, result: { ok: false, error: 'busy' } },
    { v: 1, type: 'changed' },
  ];
  const groups: [z.ZodType, { type: string }[]][] = [
    [relayHostFrameSchema, host],
    [relayControlFrameSchema, control],
    [relayClientFrameSchema, client],
    [relayBrowserFrameSchema, browser],
  ];
  for (const [index, [schema, group]] of groups.entries()) {
    for (const frame of group) {
      expect(parseRelayFrame(schema, serializeRelayFrame(schema, frame))).toEqual(frame);
      expect(() => parseRelayFrame(schema, JSON.stringify({ ...frame, owner: true }))).toThrow();
      expect(() => parseRelayFrame(schema, JSON.stringify({ ...frame, v: 2 }))).toThrow();
      for (const [otherIndex, [otherSchema]] of groups.entries()) {
        if (otherIndex === index || (frame.type === 'drop' && otherIndex < 2)) continue;
        expect(otherSchema.safeParse(frame).success).toBe(false);
      }
    }
  }
});

test('identifier, timestamp, pagination and sequence boundaries fail closed', () => {
  const descriptor = { v: 1, installationId: id, environmentId: connectionId };
  expect(relayDescriptorSchema.parse(descriptor)).toEqual(descriptor);
  expect(
    relayDescriptorSchema.safeParse({ ...descriptor, installationId: id.toUpperCase() }).success,
  ).toBe(false);
  const read = requests[1];
  for (const limit of [0, 21, 1.5])
    expect(relayRequestSchema.safeParse({ ...read, limit }).success).toBe(false);
  expect(relayRequestSchema.safeParse({ ...read, before: 'x'.repeat(129) }).success).toBe(false);
  for (const number of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      relayClientFrameSchema.safeParse({ v: 1, type: 'request', seq: number, request: requests[0] })
        .success,
    ).toBe(false);
    expect(
      relayControlFrameSchema.safeParse({ v: 1, type: 'host.ready', epoch: id, expiresAt: number })
        .success,
    ).toBe(false);
  }
});

test('UTF-8 payload and complete-frame limits account for multibyte content and JSON escaping', () => {
  const send = requests[2];
  expect(relayRequestSchema.safeParse({ ...send, content: '😀'.repeat(2048) }).success).toBe(true);
  expect(relayRequestSchema.safeParse({ ...send, content: `${'😀'.repeat(2048)}a` }).success).toBe(
    false,
  );
  const answer = {
    op: 'coordinator.answer',
    requestId: 'ask',
    answers: [{ header: 'q', text: '😀'.repeat(1024) }],
  };
  expect(relayRequestSchema.safeParse(answer).success).toBe(true);
  expect(
    relayRequestSchema.safeParse({
      ...answer,
      answers: [{ header: 'q', text: `${'😀'.repeat(1024)}a` }],
    }).success,
  ).toBe(false);
  const resultMessage = { ...message, content: '' };
  const result = {
    ok: true,
    value: { threadId: 't', messages: [resultMessage], hasEarlier: false },
  };
  const overhead = new TextEncoder().encode(JSON.stringify(result)).length;
  resultMessage.content = 'a'.repeat(RELAY_PAYLOAD_BYTES - overhead);
  expect(() => parseRelayResult('coordinator.read', result)).not.toThrow();
  resultMessage.content += 'a';
  expect(() => parseRelayResult('coordinator.read', result)).toThrow();
  resultMessage.content = '\u0000'.repeat(11_000);
  expect(() => parseRelayResult('coordinator.read', result)).toThrow();
  const text = JSON.stringify({ v: 1, type: 'changed' });
  expect(parseRelayFrame(relayBrowserFrameSchema, text.padEnd(RELAY_FRAME_BYTES))).toEqual({
    v: 1,
    type: 'changed',
  });
  for (const input of [text.padEnd(RELAY_FRAME_BYTES + 1), new ArrayBuffer(0), '{', 'null']) {
    expect(() => parseRelayFrame(relayBrowserFrameSchema, input)).toThrow();
  }
  expect(() => serializeRelayFrame(z.string(), `${'😀'.repeat(16_383)}aa`)).not.toThrow();
  expect(() => serializeRelayFrame(z.string(), `${'😀'.repeat(16_383)}aaa`)).toThrow();
});

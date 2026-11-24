import { conversationEnvelopeEventSchema, streamHelloEventSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { openStream, req } from './helpers.js';
import { bootStreamServer as bootServer } from './sse-fixture.js';

async function connect(s: ReturnType<typeof bootServer>) {
  const stream = await openStream(s.app, s.team.id);
  const hello = streamHelloEventSchema.parse(await stream.next((ev) => ev.type === 'hello'));
  return { stream, connectionId: hello.connectionId };
}

function subscribe(s: ReturnType<typeof bootServer>, connectionId: string, ids: string[]) {
  return req(s.app, 'PUT', `/api/streams/${connectionId}/conversations`, {
    conversationIds: ids,
  });
}

describe('one team stream carries the conversations a tab follows', () => {
  test('hello announces the connection id before the first ping', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    const { stream, connectionId } = await connect(s);
    expect(connectionId).not.toBe('');
    stream.close();
  });

  test('a subscribed conversation arrives wrapped in an envelope, an unsubscribed one does not', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    const { stream, connectionId } = await connect(s);
    expect((await subscribe(s, connectionId, ['conv-a'])).status).toBe(204);
    s.convHub.publishTextDelta('conv-a', 'hello');
    s.convHub.publishTextDelta('conv-b', 'ignored');
    const frame = conversationEnvelopeEventSchema.parse(
      await stream.next((ev) => ev.type === 'conversation'),
    );
    expect(frame).toEqual({
      type: 'conversation',
      conversationId: 'conv-a',
      event: { type: 'text_delta', text: 'hello' },
    });
    expect(s.convHub.subscriberCount('conv-b')).toBe(0);
    stream.close();
  });

  test('subscribing sends the current live preview', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    s.convHub.publishTextDelta('conv-a', 'partial');
    const { stream, connectionId } = await connect(s);
    await subscribe(s, connectionId, ['conv-a']);
    const frame = conversationEnvelopeEventSchema.parse(
      await stream.next((ev) => ev.type === 'conversation'),
    );
    expect(frame.event).toEqual({ type: 'text_delta', text: 'partial' });
    stream.close();
  });

  test('the set is replaced, not appended: removed conversations stop delivering', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    const { stream, connectionId } = await connect(s);
    await subscribe(s, connectionId, ['conv-a', 'conv-b']);
    expect(s.convHub.subscriberCount('conv-a')).toBe(1);
    await subscribe(s, connectionId, ['conv-b']);
    expect(s.convHub.subscriberCount('conv-a')).toBe(0);
    expect(s.convHub.subscriberCount('conv-b')).toBe(1);
    stream.close();
  });

  test('acknowledges the installed revision without letting older writes change it', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    const { stream, connectionId } = await connect(s);
    const path = `/api/streams/${connectionId}/conversations`;
    await expect(
      (await req(s.app, 'PUT', path, { conversationIds: ['conv-b'], revision: 2 })).json(),
    ).resolves.toEqual({ revision: 2 });
    await expect(
      (await req(s.app, 'PUT', path, { conversationIds: ['conv-a'], revision: 1 })).json(),
    ).resolves.toEqual({ revision: 2 });
    expect(s.convHub.subscriberCount('conv-a')).toBe(0);
    expect(s.convHub.subscriberCount('conv-b')).toBe(1);
    const reset = conversationEnvelopeEventSchema.parse(
      await stream.next((ev) => ev.type === 'conversation'),
    );
    expect(reset).toEqual({
      type: 'conversation',
      conversationId: 'conv-b',
      event: { type: 'preview_reset' },
    });
    expect((await subscribe(s, connectionId, ['conv-a'])).status).toBe(409);
    stream.close();
  });

  test('closing the stream drops every conversation subscription and the connection id', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    const { stream, connectionId } = await connect(s);
    await subscribe(s, connectionId, ['conv-a', 'conv-b']);
    stream.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(s.convHub.subscriberCount('conv-a')).toBe(0);
    expect(s.convHub.subscriberCount('conv-b')).toBe(0);
    expect((await subscribe(s, connectionId, ['conv-a'])).status).toBe(404);
  });

  test('an unknown connection id, too many conversations and a malformed body are refused', async () => {
    const s = bootServer({ pingIntervalMs: 60_000 });
    expect((await subscribe(s, 'nope', ['conv-a'])).status).toBe(404);
    const { stream, connectionId } = await connect(s);
    const tooMany = Array.from({ length: 17 }, (_, i) => `conv-${i}`);
    expect((await subscribe(s, connectionId, tooMany)).status).toBe(400);
    expect(
      (await req(s.app, 'PUT', `/api/streams/${connectionId}/conversations`, { nope: 1 })).status,
    ).toBe(400);
    stream.close();
  });
});

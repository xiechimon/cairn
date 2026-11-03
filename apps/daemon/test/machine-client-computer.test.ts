import type { ComputerCall, MachineComputerFramesBody, MachineStreamEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { NO_COMPUTER_PROVIDER_MESSAGE, rejectComputerCall } from '../src/computer/dispatch.js';
import { MachineClient } from '../src/machine-client.js';

const CALL: ComputerCall = {
  callId: 'a'.repeat(64),
  stepId: 'step-1',
  tool: 'shell',
  params: { command: 'ls' },
  deadlineAt: 1,
};

function sseClient(frames: string[]): MachineClient {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(ctrl) {
          for (const f of frames) ctrl.enqueue(new TextEncoder().encode(f));
          ctrl.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  return new MachineClient({ serverUrl: 'http://server', getToken: () => 't', fetchImpl });
}

describe('machine stream', () => {
  test('an event type this daemon does not know is skipped and later events still arrive', async () => {
    const client = sseClient([
      `data: ${JSON.stringify({ type: 'screen_open', capability: 'x' })}\n\n`,
      `data: ${JSON.stringify({ type: 'wake' })}\n\n`,
    ]);
    const seen: MachineStreamEvent[] = [];
    await client.stream(new AbortController().signal, (ev) => seen.push(ev));
    expect(seen).toEqual([{ type: 'wake' }]);
  });

  test('a malformed event of a known type still fails the stream so wire drift is not hidden', async () => {
    const malformed = sseClient([
      `data: ${JSON.stringify({ type: 'computer', call: { callId: 'short' } })}\n\n`,
    ]);
    await expect(malformed.stream(new AbortController().signal, () => {})).rejects.toThrow();
    const broken = sseClient(['data: {not json\n\n']);
    await expect(broken.stream(new AbortController().signal, () => {})).rejects.toThrow();
  });

  test('a computer event is parsed with its call', async () => {
    const client = sseClient([`data: ${JSON.stringify({ type: 'computer', call: CALL })}\n\n`]);
    const seen: MachineStreamEvent[] = [];
    await client.stream(new AbortController().signal, (ev) => seen.push(ev));
    expect(seen).toEqual([{ type: 'computer', call: CALL }]);
  });
});

describe('computer calls without a provider', () => {
  test('the daemon answers at once with a not-delivered error so the call is never left waiting', async () => {
    const posts: { path: string; body: MachineComputerFramesBody }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      posts.push({
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body)) as MachineComputerFramesBody,
      });
      return Response.json({ ok: true, cancelled: false });
    };
    const client = new MachineClient({
      serverUrl: 'http://server',
      getToken: () => 't',
      fetchImpl,
    });
    await rejectComputerCall(client, CALL);
    expect(posts).toEqual([
      {
        path: `/api/machine/computer/${CALL.callId}`,
        body: {
          frames: [
            {
              kind: 'error',
              seq: 1,
              message: NO_COMPUTER_PROVIDER_MESSAGE,
              delivery: 'not_delivered',
            },
          ],
        },
      },
    ]);
  });
});

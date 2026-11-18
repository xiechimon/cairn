import type { EngineScreenRequest, MachineStreamEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { MachineClient } from '../src/machine-client.js';

const CHANNEL: EngineScreenRequest = {
  id: 'a'.repeat(64),
  stepId: 'step-1',
  buildId: 'build-1',
  generation: 3,
  kind: 'view',
  takeoverLeaseId: null,
  takeoverFence: 0,
  fromSeq: 0,
  expiresAt: Date.now() + 60_000,
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

describe('engine screen machine stream', () => {
  test('an engine.screen event arrives as a typed channel request', async () => {
    const client = sseClient([
      `data: ${JSON.stringify({ type: 'engine.screen', channel: CHANNEL })}\n\n`,
    ]);
    const seen: MachineStreamEvent[] = [];
    await client.stream(new AbortController().signal, (ev) => seen.push(ev));
    expect(seen).toEqual([{ type: 'engine.screen', channel: CHANNEL }]);
  });

  test('a daemon built before a newer event type skips it and keeps streaming', async () => {
    const client = sseClient([
      `data: ${JSON.stringify({ type: 'engine.future', channel: CHANNEL })}\n\n`,
      `data: ${JSON.stringify({ type: 'engine.screen', channel: CHANNEL })}\n\n`,
    ]);
    const seen: MachineStreamEvent[] = [];
    await client.stream(new AbortController().signal, (ev) => seen.push(ev));
    expect(seen).toEqual([{ type: 'engine.screen', channel: CHANNEL }]);
  });

  test('a malformed engine.screen channel still fails the stream so wire drift is not hidden', async () => {
    const client = sseClient([
      `data: ${JSON.stringify({ type: 'engine.screen', channel: { id: 'short' } })}\n\n`,
    ]);
    await expect(client.stream(new AbortController().signal, () => {})).rejects.toThrow();
  });
});

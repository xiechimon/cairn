import { ChildProcess, type spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { MachineImEventBody } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createImsgBridge } from '../src/imsg-bridge.js';

interface FakeChild {
  child: ChildProcess;
  respond: (id: number, result?: unknown, error?: { code: number; message?: string }) => void;
  notify: (method: string, params: unknown) => void;
  requests: { method: string; params: Record<string, unknown> }[];
  exit: () => void;
}

const spawned: FakeChild[] = [];

function fakeSpawn(
  onRequest?: (
    req: { id: number; method: string; params: Record<string, unknown> },
    fake: FakeChild,
  ) => void,
): typeof spawn {
  return (() => {
    const child = new ChildProcess();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const fake: FakeChild = {
      child,
      requests: [],
      respond: (id, result, error) =>
        stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, ...(error !== undefined ? { error } : { result }) })}\n`,
        ),
      notify: (method, params) =>
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`),
      exit: () => child.emit('exit', 1),
    };
    Object.assign(child, {
      stdin,
      stdout,
      kill: () => {
        queueMicrotask(() => child.emit('exit', null));
        return true;
      },
    });
    let buf = '';
    stdin.on('data', (data: Buffer) => {
      buf += data.toString();
      for (;;) {
        const nl = buf.indexOf('\n');
        if (nl < 0) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim() === '') continue;
        const parsed = JSON.parse(line) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        const req = { id: parsed.id, method: parsed.method, params: parsed.params ?? {} };
        fake.requests.push({ method: req.method, params: req.params });
        if (onRequest !== undefined) onRequest(req, fake);
        else fake.respond(req.id, { ok: true });
      }
    });
    spawned.push(fake);
    return child;
  }) as typeof spawn;
}

const events: { connId: string; body: MachineImEventBody }[] = [];

function makeBridge(spawnProc: typeof spawn, now?: () => number) {
  return createImsgBridge({
    api: {
      imEvent: async (connId, body) => {
        events.push({ connId, body });
      },
    },
    logger: { machine: () => {}, wake: () => {} },
    home: mkdtempSync(join(tmpdir(), 'imsg-home-')),
    env: { CAIRN_IMSG_BIN: '/fake/imsg' },
    spawnProc,
    ...(now !== undefined ? { now } : {}),
  });
}

async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met');
}

const bodies = (kind: MachineImEventBody['kind']) =>
  events.filter((e) => e.body.kind === kind).map((e) => e.body);

async function attachAndReady(spawnProc: typeof spawn, connId = 'conn-1') {
  const bridge = makeBridge(spawnProc);
  bridge.handle({ type: 'im.attach', connId });
  await waitFor(() => bodies('status').some((b) => b.kind === 'status' && b.status === 'ready'));
  return bridge;
}

beforeEach(() => {
  spawned.length = 0;
  events.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('imsg bridge', () => {
  test('attach spawns imsg rpc, initializes and subscribes with attachments', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    const methods = spawned[0]?.requests.map((r) => r.method);
    expect(methods).toEqual(['initialize', 'watch.subscribe']);
    expect(spawned[0]?.requests[1]?.params).toEqual({ attachments: true });
    expect(bodies('status').map((b) => (b.kind === 'status' ? b.status : ''))).toEqual([
      'connecting',
      'ready',
    ]);
    bridge.stop();
  });

  test('inbound watch messages post upstream with chat guid and rowid', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 41,
        chat_guid: 'iMessage;-;+15551234',
        is_group: false,
        sender: '+15551234',
        sender_name: 'Ian',
        is_from_me: false,
        text: 'ping',
        attachments: [],
      },
    });
    await waitFor(() => bodies('message').length === 1);
    const body = bodies('message')[0];
    if (body?.kind !== 'message') throw new Error('no message body');
    expect(body.message.chat.key).toBe('iMessage;-;+15551234');
    expect(body.message.sender.id).toBe('+15551234');
    expect(body.message.messageId).toBe('msg-41');
    bridge.stop();
  });

  test('attachments on disk are read and uploaded as base64 images', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    const file = join(mkdtempSync(join(tmpdir(), 'imsg-att-')), 'photo.png');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 42,
        chat_guid: 'iMessage;-;+15551234',
        is_group: false,
        sender: '+15551234',
        is_from_me: false,
        text: '',
        attachments: [
          {
            filename: 'photo.png',
            mime_type: 'image/png',
            total_bytes: 4,
            missing: false,
            original_path: file,
          },
        ],
      },
    });
    await waitFor(() => bodies('message').length === 1);
    const body = bodies('message')[0];
    if (body?.kind !== 'message') throw new Error('no message body');
    expect(body.message.images).toHaveLength(1);
    expect(body.message.images[0]?.name).toBe('photo.png');
    expect(body.message.images[0]?.dataBase64).toBe(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
    );
    bridge.stop();
  });

  test('send issues the rpc send and reports sent; own echo is suppressed', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-1',
      message: { chatKey: 'iMessage;-;+15551234', text: 'hello back' },
    });
    await waitFor(() => bodies('sent').length === 1);
    const sentReq = spawned[0]?.requests.find((r) => r.method === 'send');
    expect(sentReq?.params).toEqual({ chat_guid: 'iMessage;-;+15551234', text: 'hello back' });
    expect(bodies('sent')[0]).toMatchObject({ kind: 'sent', sendId: 'send-1', ok: true });

    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 43,
        chat_guid: 'iMessage;-;+15551234',
        sender: '',
        is_from_me: true,
        text: 'hello back',
        attachments: [],
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(bodies('message')).toHaveLength(0);

    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 44,
        chat_guid: 'iMessage;-;+15551234',
        sender: '',
        is_from_me: true,
        text: 'typed on the mac itself',
        attachments: [],
      },
    });
    await waitFor(() => bodies('message').length === 1);
    const body = bodies('message')[0];
    if (body?.kind !== 'message') throw new Error('no message body');
    expect(body.message.sender.id).toBe('self');
    bridge.stop();
  });

  test.each([
    { code: -32001, kind: 'drop' },
    { code: -32602, kind: 'permanent' },
    { code: -32003, kind: 'retry' },
  ])('rpc send error $code reports kind $kind', async ({ code, kind }) => {
    const bridge = makeBridge(
      fakeSpawn((req, fake) => {
        if (req.method === 'send') {
          fake.respond(req.id, undefined, { code, message: `err ${code}` });
          return;
        }
        fake.respond(req.id, { ok: true });
      }),
    );
    bridge.handle({ type: 'im.attach', connId: 'conn-1' });
    await waitFor(() => bodies('status').some((b) => b.kind === 'status' && b.status === 'ready'));
    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-err',
      message: { chatKey: 'iMessage;-;+1', text: 'x' },
    });
    await waitFor(() => bodies('sent').length === 1);
    expect(bodies('sent')[0]).toMatchObject({ kind: 'sent', ok: false, errorKind: kind });
    bridge.stop();
  });

  test('a numeric or label reply to a card becomes an action', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-card',
      message: {
        chatKey: 'iMessage;-;+15551234',
        text: 'approve?\n\n1. Approve\n2. Refuse',
        buttons: [
          [
            { label: 'Approve', value: 'imcb:req-1:0' },
            { label: 'Refuse', value: 'imcb:req-1:1' },
          ],
        ],
      },
    });
    await waitFor(() => bodies('sent').length === 1);
    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 45,
        chat_guid: 'iMessage;-;+15551234',
        sender: '+15551234',
        is_from_me: false,
        text: '1',
        attachments: [],
      },
    });
    await waitFor(() => bodies('action').length === 1);
    const action = bodies('action')[0];
    if (action?.kind !== 'action') throw new Error('no action body');
    expect(action.action.value).toBe('imcb:req-1:0');

    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-card-2',
      message: {
        chatKey: 'iMessage;-;+15551234',
        text: 'pick\n\n1. Approve\n2. Refuse',
        buttons: [
          [
            { label: 'Approve', value: 'imcb:req-2:0' },
            { label: 'Refuse', value: 'imcb:req-2:1' },
          ],
        ],
      },
    });
    await waitFor(() => bodies('sent').length === 2);
    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 46,
        chat_guid: 'iMessage;-;+15551234',
        sender: '+15551234',
        is_from_me: false,
        text: 'refuse',
        attachments: [],
      },
    });
    await waitFor(() => bodies('action').length === 2);
    const second = bodies('action')[1];
    if (second?.kind !== 'action') throw new Error('no action body');
    expect(second.action.value).toBe('imcb:req-2:1');
    bridge.stop();
  });

  test('child exit posts degraded and respawns while attached', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    expect(spawned).toHaveLength(1);
    spawned[0]?.exit();
    await waitFor(() =>
      bodies('status').some((b) => b.kind === 'status' && b.status === 'degraded'),
    );
    await waitFor(() => spawned.length >= 2, 400);
    await waitFor(() => {
      const readies = bodies('status').filter((b) => b.kind === 'status' && b.status === 'ready');
      return readies.length >= 2;
    }, 400);
    bridge.stop();
  });

  test('managed install refuses a sha256 mismatch and reports error', async () => {
    const bridge = createImsgBridge({
      api: {
        imEvent: async (connId, body) => {
          events.push({ connId, body });
        },
      },
      logger: { machine: () => {}, wake: () => {} },
      home: mkdtempSync(join(tmpdir(), 'imsg-home-')),
      env: {},
      spawnProc: fakeSpawn(),
      fetchImpl: (() => Promise.resolve(new Response('not-the-real-zip'))) as typeof fetch,
    });
    bridge.handle({ type: 'im.attach', connId: 'conn-1' });
    await waitFor(() => bodies('status').some((b) => b.kind === 'status' && b.status === 'error'));
    const err = bodies('status').find((b) => b.kind === 'status' && b.status === 'error');
    if (err?.kind !== 'status') throw new Error('no error status');
    expect(err.detail).toContain('sha256 mismatch');
    expect(spawned).toHaveLength(0);
    bridge.stop();
  });

  test('im.detach kills the child and stops posting', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    bridge.handle({ type: 'im.detach', connId: 'conn-1' });
    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-after-detach',
      message: { chatKey: 'iMessage;-;+1', text: 'x' },
    });
    await waitFor(() => bodies('sent').length === 1);
    expect(bodies('sent')[0]).toMatchObject({ kind: 'sent', ok: false, errorKind: 'retry' });
    expect(bridge.sessionCount()).toBe(0);
    bridge.stop();
  });
});

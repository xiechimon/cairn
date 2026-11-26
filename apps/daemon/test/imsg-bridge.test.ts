import { ChildProcess, type spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { MachineImEventBody } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createImsgBridge } from '../src/imsg-bridge.js';

interface FakeChild {
  child: ChildProcess;
  respond: (
    id: number,
    result?: unknown,
    error?: { code: number; message?: string; data?: { detail?: string } },
  ) => void;
  notify: (method: string, params: unknown) => void;
  emitStderr: (text: string) => void;
  requests: { method: string; params: Record<string, unknown> }[];
  exit: () => void;
}

const spawned: FakeChild[] = [];
const dirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  dirs.push(dir);
  return dir;
}

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
    const stderr = new PassThrough();
    const fake: FakeChild = {
      child,
      requests: [],
      respond: (id, result, error) =>
        stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, ...(error !== undefined ? { error } : { result }) })}\n`,
        ),
      notify: (method, params) =>
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`),
      emitStderr: (text) => stderr.write(text),
      exit: () => child.emit('exit', 1),
    };
    Object.assign(child, {
      stdin,
      stdout,
      stderr,
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
    home: makeDir('imsg-home-'),
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
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
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
    const file = join(makeDir('imsg-att-'), 'photo.png');
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
      home: makeDir('imsg-home-'),
      env: {},
      platform: 'darwin',
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

  test('watch.overflow notification marks degraded with reason and respawns imsg rpc', async () => {
    const bridge = await attachAndReady(fakeSpawn());
    expect(spawned).toHaveLength(1);

    spawned[0]?.notify('watch.overflow', {
      subscription: 1,
      resume_after_rowid: 9000,
      reason: 'buffer_limit_exceeded',
      terminal: true,
    });

    await waitFor(() =>
      bodies('status').some(
        (b) => b.kind === 'status' && b.status === 'degraded' && b.detail?.includes('overflow'),
      ),
    );
    await waitFor(() => spawned.length >= 2, 400);
    await waitFor(
      () => bodies('status').filter((b) => b.kind === 'status' && b.status === 'ready').length >= 2,
      400,
    );
    bridge.stop();
  });

  test('own echo is suppressed by returned guid and after -32001 uncertain send failure', async () => {
    const bridge = makeBridge(
      fakeSpawn((req, fake) => {
        if (req.method === 'send' && req.params.text === 'uncertain') {
          fake.respond(req.id, undefined, { code: -32001, message: 'may_have_completed' });
          return;
        }
        if (req.method === 'send') {
          fake.respond(req.id, { ok: true, guid: 'GUID-OWN-1' });
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
      sendId: 'send-guid',
      message: { chatKey: 'iMessage;-;+15551234', text: 'hello guid' },
    });
    await waitFor(() => bodies('sent').length === 1);

    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 50,
        guid: 'GUID-OWN-1',
        chat_guid: 'iMessage;-;+15551234',
        sender: '',
        is_from_me: true,
        text: 'hello  guid (normalized)',
        attachments: [],
      },
    });

    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-uncertain',
      message: { chatKey: 'iMessage;-;+15551234', text: 'uncertain' },
    });
    await waitFor(() => bodies('sent').length === 2);

    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 51,
        chat_guid: 'iMessage;-;+15551234',
        sender: '',
        is_from_me: true,
        text: 'uncertain',
        attachments: [],
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(bodies('message')).toHaveLength(0);
    bridge.stop();
  });

  test('watch.subscribe -32002 surfaces Full Disk Access guidance and clears dead rpc ref', async () => {
    const bridge = makeBridge(
      fakeSpawn((req, fake) => {
        if (req.method === 'watch.subscribe') {
          fake.respond(req.id, undefined, { code: -32002, message: 'chat.db unreadable' });
          return;
        }
        fake.respond(req.id, { ok: true });
      }),
    );
    bridge.handle({ type: 'im.attach', connId: 'conn-1' });
    await waitFor(() =>
      bodies('status').some((b) => b.kind === 'status' && b.status === 'degraded'),
    );
    const degraded = bodies('status').find((b) => b.kind === 'status' && b.status === 'degraded');
    if (degraded?.kind !== 'status') throw new Error('missing degraded status');
    expect(degraded.detail).toContain('Full Disk Access');

    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-while-down',
      message: { chatKey: 'iMessage;-;+1', text: 'hi' },
    });
    await waitFor(() => bodies('sent').length === 1);
    expect(bodies('sent')[0]).toMatchObject({
      kind: 'sent',
      ok: false,
      errorKind: 'retry',
      error: 'imsg bridge is not attached',
    });
    bridge.stop();
  });

  test('non-darwin host refuses imsg download, reports error, and does not respawn', async () => {
    let fetchCalls = 0;
    const bridge = createImsgBridge({
      api: {
        imEvent: async (connId, body) => {
          events.push({ connId, body });
        },
      },
      logger: { machine: () => {}, wake: () => {} },
      home: makeDir('imsg-home-'),
      env: {},
      platform: 'linux',
      spawnProc: fakeSpawn(),
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response('nope');
      }) as typeof fetch,
    });
    bridge.handle({ type: 'im.attach', connId: 'conn-1' });
    await waitFor(() => bodies('status').some((b) => b.kind === 'status' && b.status === 'error'));
    const err = bodies('status').find((b) => b.kind === 'status' && b.status === 'error');
    if (err?.kind !== 'status') throw new Error('no error status');
    expect(err.detail).toContain('macOS');
    expect(fetchCalls).toBe(0);
    expect(spawned).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(
      bodies('status').filter((b) => b.kind === 'status' && b.status === 'error'),
    ).toHaveLength(1);
    bridge.stop();
  });

  test('resolves executable imsg from PATH on darwin without downloading', async () => {
    const binDir = makeDir('imsg-path-');
    const binPath = join(binDir, 'imsg');
    writeFileSync(binPath, '#!/bin/sh\n');
    chmodSync(binPath, 0o755);
    let fetchCalls = 0;
    const spawnedBins: string[] = [];
    const innerSpawn = fakeSpawn();
    const trackingSpawn: typeof spawn = ((cmd: string, args: readonly string[], opts: unknown) => {
      spawnedBins.push(cmd);
      return innerSpawn(cmd, args as string[], opts as never);
    }) as typeof spawn;

    const bridge = createImsgBridge({
      api: {
        imEvent: async (connId, body) => {
          events.push({ connId, body });
        },
      },
      logger: { machine: () => {}, wake: () => {} },
      home: makeDir('imsg-home-'),
      env: { PATH: binDir },
      platform: 'darwin',
      spawnProc: trackingSpawn,
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response('nope');
      }) as typeof fetch,
    });
    bridge.handle({ type: 'im.attach', connId: 'conn-1' });
    await waitFor(() => bodies('status').some((b) => b.kind === 'status' && b.status === 'ready'));
    expect(fetchCalls).toBe(0);
    expect(spawnedBins).toEqual([binPath]);
    bridge.stop();
  });

  test('outbound AppleScript -1743 surfaces degraded Automation guidance, captures stderr, and recovers on success', async () => {
    let deny = true;
    const bridge = makeBridge(
      fakeSpawn((req, fake) => {
        if (req.method === 'send' && deny) {
          fake.emitStderr(
            'osascript: execution error: Not authorized to send Apple events to Messages. (-1743)\n',
          );
          fake.respond(req.id, undefined, {
            code: -32603,
            message: 'AppleScript failed (-1743)',
          });
          return;
        }
        fake.respond(req.id, { ok: true, guid: 'GUID-RECOVERED' });
      }),
    );
    bridge.handle({ type: 'im.attach', connId: 'conn-1' });
    await waitFor(() => bodies('status').some((b) => b.kind === 'status' && b.status === 'ready'));

    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-1743',
      message: { chatKey: 'iMessage;-;+1', text: 'hi' },
    });
    await waitFor(() => bodies('sent').length === 1);
    expect(bodies('sent')[0]).toMatchObject({
      kind: 'sent',
      sendId: 'send-1743',
      ok: false,
      errorKind: 'permanent',
    });
    const degraded = bodies('status').find((b) => b.kind === 'status' && b.status === 'degraded');
    expect(degraded?.kind === 'status' ? degraded.detail : '').toContain('Automation');
    expect(degraded?.kind === 'status' ? degraded.detail : '').toContain('-1743');
    expect(spawned).toHaveLength(1);

    deny = false;
    bridge.handle({
      type: 'im.send',
      connId: 'conn-1',
      sendId: 'send-ok',
      message: { chatKey: 'iMessage;-;+1', text: 'recovered' },
    });
    await waitFor(() => bodies('sent').length === 2);
    expect(
      bodies('status').filter((b) => b.kind === 'status' && b.status === 'ready').length,
    ).toBeGreaterThanOrEqual(2);
    bridge.stop();
  });

  test('outbound AppleScript -1712 surfaces degraded timeout guidance as retry', async () => {
    const bridge = makeBridge(
      fakeSpawn((req, fake) => {
        if (req.method === 'send') {
          fake.respond(req.id, undefined, {
            code: -32603,
            message: 'AppleEvent timed out (-1712)',
          });
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
      sendId: 'send-1712',
      message: { chatKey: 'iMessage;-;+1', text: 'hi' },
    });
    await waitFor(() => bodies('sent').length === 1);
    expect(bodies('sent')[0]).toMatchObject({
      kind: 'sent',
      ok: false,
      errorKind: 'retry',
    });
    const degraded = bodies('status').find((b) => b.kind === 'status' && b.status === 'degraded');
    expect(degraded?.kind === 'status' ? degraded.detail : '').toContain('-1712');
    bridge.stop();
  });

  test('respawn passes since_rowid and drops stale backlog messages older than 15 minutes', async () => {
    const currentTime = 1_700_000_000_000;
    const bridge = makeBridge(fakeSpawn(), () => currentTime);
    bridge.handle({ type: 'im.attach', connId: 'conn-1' });
    await waitFor(() => bodies('status').some((b) => b.kind === 'status' && b.status === 'ready'));

    spawned[0]?.notify('message', {
      subscription: 1,
      message: {
        id: 41,
        chat_guid: 'iMessage;-;+15551234',
        sender: '+15551234',
        text: 'fresh msg',
        created_at: new Date(currentTime - 10_000).toISOString(),
        attachments: [],
      },
    });
    await waitFor(() => bodies('message').length === 1);

    spawned[0]?.notify('watch.overflow', {
      subscription: 1,
      resume_after_rowid: 45,
      reason: 'buffer_limit_exceeded',
    });
    await waitFor(() => spawned.length >= 2, 400);
    await waitFor(
      () => bodies('status').filter((b) => b.kind === 'status' && b.status === 'ready').length >= 2,
      400,
    );

    const resubscribe = spawned[1]?.requests.find((r) => r.method === 'watch.subscribe');
    expect(resubscribe?.params).toEqual({ attachments: true, since_rowid: 45 });

    spawned[1]?.notify('message', {
      subscription: 1,
      message: {
        id: 46,
        chat_guid: 'iMessage;-;+15551234',
        sender: '+15551234',
        text: 'stale backlog bomb',
        created_at: new Date(currentTime - 20 * 60_000).toISOString(),
        attachments: [],
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(bodies('message')).toHaveLength(1);
    bridge.stop();
  });
});

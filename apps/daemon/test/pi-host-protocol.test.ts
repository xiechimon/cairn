import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionOpts, StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { createPiBackend } from '../src/backend/pi.js';
import { PI_HOST_MAX_FRAME_BYTES } from '../src/backend/pi-host-protocol.js';
import { testTempDir } from './test-temp-dir.js';

const HOST = `
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const mode = process.argv[2];
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
let buffer = '';
let session = null;
const ready = (extra = {}) => {
  const file = join(session.sessionDir, 'session.jsonl');
  writeFileSync(file, '');
  send({ t: 'ready', v: 1, sessionId: 'sid', sessionFile: file, ...extra });
};
const text = (value) => ({ t: 'event', event: { type: 'text_delta', text: value } });
const done = () => ({ t: 'event', event: { type: 'done', usage: [] } });
process.stdin.on('data', (data) => {
  buffer += data;
  let index;
  while ((index = buffer.indexOf('\\n')) !== -1) {
    const frame = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    handle(frame);
  }
});
process.stdin.on('end', () => process.exit(0));
function handle(frame) {
  if (frame.t === 'initialize') {
    session = frame;
    if (mode === 'crash') { process.stderr.write('boom ' + frame.session.provider.apiKey); process.exit(3); }
    if (mode === 'oversize') { ready(); process.stdout.write('x'.repeat(${PI_HOST_MAX_FRAME_BYTES + 1024})); return; }
    if (mode === 'garbage') { process.stdout.write('not json\\n'); return; }
    if (mode === 'version') { send({ t: 'ready', v: 2, sessionId: 'sid' }); return; }
    if (mode === 'foreign-file') { send({ t: 'ready', v: 1, sessionId: 'sid', sessionFile: '/etc/hosts' }); return; }
    if (mode === 'early-event') { send(text('early')); return; }
    ready();
    if (mode === 'stream') { send(text('a')); send(text('b')); send({ t: 'usage', usage: [{ model: 'm', input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }] }); send(done()); send({ t: 'ended' }); return; }
    if (mode === 'tool') { send({ t: 'tool_request', id: 't1', kind: 'remote', name: 'ask_user', params: { q: 1 } }); return; }
    if (mode === 'undeclared') { send({ t: 'tool_request', id: 't1', kind: 'remote', name: 'delete_everything', params: {} }); return; }
    if (mode === 'unknown-method') { send({ t: 'read_file', path: '/etc/hosts' }); return; }
    if (mode === 'local') { send({ t: 'tool_request', id: 't1', kind: 'local', name: 'lookup', params: { q: 2 } }); return; }
    if (mode === 'echo-secrets') { send({ t: 'tool_request', id: 't1', kind: 'remote', name: 'ask_user', params: { echo: frame.session.secrets } }); return; }
    if (mode === 'mcp-secret') { send({ t: 'log', channel: 'mcp', message: 'connect failed: ' + (frame.session.secrets ?? []).join(' ') }); send({ t: 'ended' }); return; }
    if (mode === 'crash-secret') { process.stderr.write('boom ' + (frame.session.secrets ?? []).join(' ')); process.exit(3); }
    return;
  }
  if (frame.t === 'steer') { send({ t: 'steer_reply', id: frame.id, ok: frame.text !== 'reject', error: 'no' }); return; }
  if (frame.t === 'tool_reply') { send(text(frame.ok ? 'reply:' + frame.text : 'error:' + frame.error)); send(done()); send({ t: 'ended' }); return; }
  if (frame.t === 'stop') { send({ t: 'ended' }); }
}
`;

function fixture() {
  const root = testTempDir('pi-host-protocol-');
  const agentDir = join(root, 'agent');
  const sessionDir = join(root, 'sessions');
  const script = join(root, 'host.mjs');
  const spawned = join(root, 'spawned');
  writeFileSync(script, HOST);
  const sessions: [string, string | undefined][] = [];
  const logs: string[] = [];
  const make = (
    mode: string,
    confine?: NonNullable<Parameters<typeof createPiBackend>[0]['confine']>,
  ) =>
    createPiBackend({
      agentDir,
      sessionDir,
      onSession: (id, file) => sessions.push([id, file]),
      onGateLog: (line) => logs.push(line),
      onMcpLog: (line) => logs.push(line),
      resolveSessionFile: () => null,
      confine:
        confine ??
        ((_opts, harness, launch, extra) => {
          expect(harness).toBe('pi');
          expect(extra?.state?.[0]).toBe(agentDir);
          writeFileSync(spawned, 'yes');
          return launch;
        }),
      hostLaunch: () => ({ command: process.execPath, args: [script, mode] }),
    });
  return { root, agentDir, sessionDir, spawned, sessions, logs, make };
}

function session(root: string, extra: Partial<SessionOpts> = {}): SessionOpts {
  mkdirSync(join(root, 'work'), { recursive: true });
  return {
    cwd: join(root, 'work'),
    modelId: 'm',
    prompt: 'go',
    provider: {
      kind: 'http',
      providerId: 'p',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      apiKey: 'secret-key-value',
      models: [{ id: 'm', name: 'M' }],
    },
    ...extra,
  };
}

async function drain(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('pi host protocol', () => {
  test('initialize returns the session identity, events arrive in order, usage is kept', async () => {
    const f = fixture();
    const handle = await f.make('stream').createSession(session(f.root));
    expect(handle.sessionId).toBe('sid');
    expect(f.sessions).toEqual([['sid', handle.sessionFile]]);
    const events = await drain(handle.events);
    expect(events.map((event) => event.type)).toEqual(['text_delta', 'text_delta', 'done']);
    expect(handle.usage()).toEqual([
      { model: 'm', input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    ]);
  });

  test('steer round-trips and a rejection reaches the caller', async () => {
    const f = fixture();
    const handle = await f.make('idle').createSession(session(f.root));
    await expect(handle.steer('hello')).resolves.toBeUndefined();
    await expect(handle.steer('reject')).rejects.toThrow('no');
    await handle.stop();
  });

  test('stop closes the stream and rejects later steering', async () => {
    const f = fixture();
    const handle = await f.make('idle').createSession(session(f.root));
    const pending = drain(handle.events);
    await handle.stop();
    expect(await pending).toEqual([]);
    await expect(handle.steer('late')).rejects.toThrow('closed or stopping');
  });

  test('a declared remote tool request is executed by the parent and answered by id', async () => {
    const f = fixture();
    const calls: [string, Record<string, unknown>][] = [];
    const handle = await f.make('tool').createSession(
      session(f.root, {
        remoteTools: [{ name: 'ask_user', description: 'ask' }],
        executeRemoteTool: async (name, params) => {
          calls.push([name, params]);
          return 'answer';
        },
      }),
    );
    const events = await drain(handle.events);
    expect(calls).toEqual([['ask_user', { q: 1 }]]);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'reply:answer' });
  });

  test('a declared local tool failure is reported back as an error reply', async () => {
    const f = fixture();
    const handle = await f.make('local').createSession(
      session(f.root, {
        localTools: [
          {
            name: 'lookup',
            description: 'look',
            execute: async () => {
              throw new Error('nope');
            },
          },
        ],
      }),
    );
    expect((await drain(handle.events))[0]).toEqual({ type: 'text_delta', text: 'error:nope' });
  });

  test.each([
    ['undeclared', 'undeclared tool'],
    ['unknown-method', 'invalid'],
  ])('%s requests fail the session without running anything', async (mode, message) => {
    const f = fixture();
    let ran = false;
    const handle = await f.make(mode).createSession(
      session(f.root, {
        remoteTools: [{ name: 'ask_user', description: 'ask' }],
        executeRemoteTool: async () => {
          ran = true;
          return '';
        },
      }),
    );
    const events = await drain(handle.events);
    expect(ran).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'error' && events[0].error.message).toContain(message);
  });

  test('a child crash ends the stream with one scrubbed error and no success', async () => {
    const f = fixture();
    await expect(f.make('crash').createSession(session(f.root))).rejects.toThrow(
      /(exited unexpectedly|closed its pipe).*boom \[REDACTED\]/,
    );
  });

  test('an oversized frame fails the session', async () => {
    const f = fixture();
    const handle = await f.make('oversize').createSession(session(f.root));
    const events = await drain(handle.events);
    expect(events.map((event) => event.type)).toEqual(['error']);
    expect(events[0]?.type === 'error' && events[0].error.message).toContain('size limit');
  }, 30_000);

  test.each([
    ['garbage', 'not JSON'],
    ['version', 'invalid'],
    ['foreign-file', 'outside its private directory'],
    ['early-event', 'early'],
  ])('%s before ready rejects the open', async (mode, message) => {
    const f = fixture();
    await expect(f.make(mode).createSession(session(f.root))).rejects.toThrow(message);
  });

  test('step secrets ride the initialize frame for the host to redact with', async () => {
    const f = fixture();
    const calls: [string, Record<string, unknown>][] = [];
    const handle = await f.make('echo-secrets').createSession(
      session(f.root, {
        remoteTools: [{ name: 'ask_user', description: 'ask' }],
        executeRemoteTool: async (name, params) => {
          calls.push([name, params]);
          return 'ok';
        },
        secrets: () => ['step-secret-host-9'],
      }),
    );
    await drain(handle.events);
    expect(calls).toEqual([['ask_user', { echo: ['step-secret-host-9'] }]]);
  });

  test('host log frames are scrubbed with the step credential list', async () => {
    const f = fixture();
    const handle = await f
      .make('mcp-secret')
      .createSession(session(f.root, { secrets: () => ['step-secret-host-9'] }));
    await drain(handle.events);
    const joined = f.logs.join('\n');
    expect(joined).not.toContain('step-secret-host-9');
    expect(joined).toContain('[REDACTED]');
  });

  test('a crashed host exposes no step credential in its stderr tail', async () => {
    const f = fixture();
    const handle = await f
      .make('crash-secret')
      .createSession(session(f.root, { secrets: () => ['step-secret-host-9'] }));
    const events = await drain(handle.events);
    const message = events.find((event) => event.type === 'error')?.error.message ?? '';
    expect(message).toContain('boom [REDACTED]');
    expect(message).not.toContain('step-secret-host-9');
  });

  test('a confiner failure returns no handle and starts no child', async () => {
    const f = fixture();
    const backend = f.make('stream', () => {
      throw new Error('profile rejected');
    });
    await expect(backend.createSession(session(f.root))).rejects.toThrow(
      'Pi session confinement failed: profile rejected',
    );
    expect(existsSync(f.spawned)).toBe(false);
    expect(readdirSync(f.sessionDir)).toEqual([]);
  });

  test('resuming a missing transcript is refused before any child starts', async () => {
    const f = fixture();
    await expect(f.make('stream').continueSession('gone', session(f.root))).rejects.toBeInstanceOf(
      SessionNotResumableError,
    );
    expect(existsSync(f.spawned)).toBe(false);
  });
});

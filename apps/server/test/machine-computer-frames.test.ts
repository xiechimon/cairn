import { createHash } from 'node:crypto';
import { machineComputerFramesResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import { computer, computerCall, machine } from '../src/db/schema.js';
import {
  COMPUTER_OUTPUT_HEAD_CHARS,
  COMPUTER_OUTPUT_TAIL_CHARS,
} from '../src/services/machine-computer.js';
import { bootServer, issueApiKey } from './helpers.js';

type Server = ReturnType<typeof bootServer>;

let server: Server | null = null;
afterEach(() => {
  server?.dispose();
  server = null;
});

async function post(app: Hono, path: string, cred: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${cred}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function enroll(
  s: Server,
  key: string,
  name: string,
): Promise<{ id: string; token: string }> {
  const res = await post(s.app, '/api/machine/enroll', key, { teamId: s.team.id, name });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  const row = s.db.select().from(machine).where(eq(machine.name, name)).get();
  if (!row) throw new Error(`machine ${name} not enrolled`);
  return { id: row.id, token: body.token };
}

function callId(stepId: string, toolCallId: string): string {
  return createHash('sha256').update(`${stepId}:${toolCallId}`).digest('hex');
}

function insertCall(s: Server, machineId: string, toolCallId = 'tc-1'): string {
  const id = callId('step-1', toolCallId);
  s.db
    .insert(computerCall)
    .values({
      id,
      teamId: s.team.id,
      stepId: 'step-1',
      toolCallId,
      machineId,
      tool: 'shell',
      replaySafe: false,
      params: { command: 'ls' },
      deadlineAt: Date.now() + 60_000,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

function row(s: Server, id: string) {
  const r = s.db.select().from(computerCall).where(eq(computerCall.id, id)).get();
  if (!r) throw new Error('call row missing');
  return r;
}

async function setup() {
  const s = bootServer();
  server = s;
  const owner = await enroll(s, await issueApiKey(s), 'omarchy');
  const other = await enroll(s, await issueApiKey(s), 'intruder');
  const id = insertCall(s, owner.id);
  return { s, owner, other, id };
}

describe('POST /api/machine/computer/:callId', () => {
  test('a machine other than the call target gets 404 and the call is untouched', async () => {
    const { s, other, id } = await setup();
    const res = await post(s.app, `/api/machine/computer/${id}`, other.token, {
      frames: [{ kind: 'done', seq: 1, text: 'forged' }],
    });
    expect(res.status).toBe(404);
    expect(row(s, id).state).toBe('dispatched');
    expect(row(s, id).resultText).toBeNull();
  });

  test('an unknown call id gets 404', async () => {
    const { s, owner } = await setup();
    const res = await post(s.app, `/api/machine/computer/${callId('nope', 'nope')}`, owner.token, {
      frames: [{ kind: 'heartbeat', seq: 1 }],
    });
    expect(res.status).toBe(404);
  });

  test('a malformed call id or frame is rejected with 400', async () => {
    const { s, owner, id } = await setup();
    const badId = await post(s.app, '/api/machine/computer/not-a-hash', owner.token, {
      frames: [{ kind: 'heartbeat', seq: 1 }],
    });
    expect(badId.status).toBe(400);
    const badFrame = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [{ kind: 'done', seq: 0, text: '' }],
    });
    expect(badFrame.status).toBe(400);
    const hugeImage = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [
        {
          kind: 'done',
          seq: 1,
          text: '',
          images: [{ data: 'A'.repeat(4 * 1024 * 1024 + 4), mimeType: 'image/png' }],
        },
      ],
    });
    expect(hugeImage.status).toBe(400);
    expect(row(s, id).state).toBe('dispatched');
  });

  test('output frames move the call to running and a retried frame is not appended twice', async () => {
    const { s, owner, id } = await setup();
    const frame = { kind: 'output', seq: 1, stream: 'stdout', text: 'hello\n' };
    const first = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [frame],
    });
    expect(first.status).toBe(200);
    expect(machineComputerFramesResponseSchema.parse(await first.json())).toEqual({
      ok: true,
      cancelled: false,
    });
    const retry = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [frame],
    });
    expect(retry.status).toBe(200);
    const r = row(s, id);
    expect(r.state).toBe('running');
    expect(r.outputHead).toBe('hello\n');
    expect(r.outputChars).toBe(6);
    expect(r.lastSeq).toBe(1);
    expect(r.startedAt).not.toBeNull();
  });

  test('a gap in frame sequence is refused so lost output is never silently skipped', async () => {
    const { s, owner, id } = await setup();
    const res = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [{ kind: 'output', seq: 2, stream: 'stdout', text: 'late' }],
    });
    expect(res.status).toBe(409);
    expect(row(s, id).lastSeq).toBe(0);
  });

  test('done records the result and images, and later frames are refused', async () => {
    const { s, owner, id } = await setup();
    const image = { data: 'iVBORw0KGgo=', mimeType: 'image/png' };
    const done = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [
        { kind: 'output', seq: 1, stream: 'stdout', text: 'a' },
        { kind: 'done', seq: 2, text: 'finished', images: [image], exitCode: 0 },
      ],
    });
    expect(done.status).toBe(200);
    const r = row(s, id);
    expect(r.state).toBe('done');
    expect(r.resultText).toBe('finished');
    expect(r.resultImages).toEqual([image]);
    expect(r.exitCode).toBe(0);
    expect(r.finishedAt).not.toBeNull();
    const after = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [{ kind: 'output', seq: 3, stream: 'stdout', text: 'more' }],
    });
    expect(after.status).toBe(409);
    const repeatDone = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [{ kind: 'done', seq: 2, text: 'finished' }],
    });
    expect(repeatDone.status).toBe(200);
  });

  test('a frame after a terminal frame in the same post is refused and nothing is stored', async () => {
    const { s, owner, id } = await setup();
    const res = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [
        { kind: 'done', seq: 1, text: 'finished' },
        { kind: 'output', seq: 2, stream: 'stdout', text: 'after' },
      ],
    });
    expect(res.status).toBe(409);
    expect(row(s, id).state).toBe('dispatched');
  });

  test('error frames keep whether the action may have been delivered', async () => {
    const { s, owner, id } = await setup();
    const res = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [{ kind: 'error', seq: 1, message: 'no provider', delivery: 'not_delivered' }],
    });
    expect(res.status).toBe(200);
    const r = row(s, id);
    expect(r.state).toBe('error');
    expect(r.errorMessage).toBe('no provider');
    expect(r.errorDelivery).toBe('not_delivered');
  });

  test('token-shaped strings in output, results and errors never reach the database', async () => {
    const { s, owner, id } = await setup();
    const token = `ghp_${'a'.repeat(36)}`;
    const res = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [
        { kind: 'output', seq: 1, stream: 'stdout', text: `half ${token.slice(0, 10)}` },
        { kind: 'output', seq: 2, stream: 'stderr', text: `${token.slice(10)} end ${token}` },
        { kind: 'done', seq: 3, text: `result ${token}` },
      ],
    });
    expect(res.status).toBe(200);
    const id2 = insertCall(s, owner.id, 'tc-2');
    await post(s.app, `/api/machine/computer/${id2}`, owner.token, {
      frames: [{ kind: 'error', seq: 1, message: `failed with ${token}`, delivery: 'unknown' }],
    });
    const dump = JSON.stringify([row(s, id), row(s, id2)]);
    expect(dump).not.toContain('a'.repeat(20));
    expect(dump).toContain('[REDACTED]');
  });

  test('output keeps a bounded head and tail with the full character count', async () => {
    const { s, owner, id } = await setup();
    const chunk = 'x'.repeat(60 * 1024);
    const frames = [1, 2, 3].map((seq) => ({
      kind: 'output',
      seq,
      stream: 'stdout',
      text: seq === 3 ? `${chunk.slice(4)}LAST` : chunk,
    }));
    const res = await post(s.app, `/api/machine/computer/${id}`, owner.token, { frames });
    expect(res.status).toBe(200);
    const r = row(s, id);
    expect(r.outputHead.length).toBe(COMPUTER_OUTPUT_HEAD_CHARS);
    expect(r.outputTail.length).toBe(COMPUTER_OUTPUT_TAIL_CHARS);
    expect(r.outputTail.endsWith('LAST')).toBe(true);
    expect(r.outputChars).toBe(3 * 60 * 1024);
  });

  test('a cancelled call tells the daemon to stop and still records its final frame', async () => {
    const { s, owner, id } = await setup();
    s.db.update(computerCall).set({ state: 'cancelled' }).where(eq(computerCall.id, id)).run();
    const res = await post(s.app, `/api/machine/computer/${id}`, owner.token, {
      frames: [{ kind: 'error', seq: 1, message: 'killed', delivery: 'unknown' }],
    });
    expect(res.status).toBe(200);
    expect(machineComputerFramesResponseSchema.parse(await res.json()).cancelled).toBe(true);
    const r = row(s, id);
    expect(r.state).toBe('cancelled');
    expect(r.errorMessage).toBe('killed');
    expect(r.finishedAt).not.toBeNull();
  });
});

describe('computer tables and machine removal', () => {
  test('deleting a machine removes its computer and calls instead of failing on the foreign key', async () => {
    const { s, owner, id } = await setup();
    s.db
      .insert(computer)
      .values({
        id: 'computer-1',
        teamId: s.team.id,
        scopeKey: 'chief:chief-1',
        machineId: owner.id,
        providerRef: 'cairn-orb-computer-chief-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    s.db
      .update(computerCall)
      .set({ computerId: 'computer-1' })
      .where(eq(computerCall.id, id))
      .run();
    const res = await s.app.request(`/api/machines/${owner.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(s.db.select().from(computer).all()).toEqual([]);
    expect(s.db.select().from(computerCall).all()).toEqual([]);
  });

  test('two computers cannot share one scope key', async () => {
    const { s, owner } = await setup();
    const values = {
      teamId: s.team.id,
      scopeKey: 'chief:chief-1',
      machineId: owner.id,
      providerRef: 'cairn-orb-computer-chief-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    s.db
      .insert(computer)
      .values({ id: 'c-1', ...values })
      .run();
    expect(() =>
      s.db
        .insert(computer)
        .values({ id: 'c-2', ...values })
        .run(),
    ).toThrow();
  });
});

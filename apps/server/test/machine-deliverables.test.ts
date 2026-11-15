import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type ClaimedStep, machineEnrollResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  attachment as attachmentTable,
  message as messageTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { sweepAttachments, sweepUploadParts } from '../src/services/attachment-gc.js';
import { deleteTodo } from '../src/services/todos.js';
import { bootServer, issueApiKey, postProject, seedSessionRoute } from './helpers.js';

const silent = { info: () => undefined, debug: () => undefined };
const DAY = 24 * 60 * 60 * 1000;

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; raw?: Buffer } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.raw !== undefined) headers['content-type'] = 'application/octet-stream';
  return app.request(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.raw,
  });
}

async function world(output: 'info' | 'code' = 'info') {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const apiKey = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-1',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model' });
  const enrolled = machineEnrollResponseSchema.parse(
    await (
      await call(s.app, 'POST', '/api/machine/enroll', {
        cred: apiKey,
        body: readyMachine({ teamId: s.team.id, name: 'mbp', cliVersion: '0.1.0' }),
      })
    ).json(),
  );
  const projectId = await postProject(s.app);
  const todoId = (
    (await (
      await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: 'Research', spec: 'Write a page' },
      })
    ).json()) as { id: string }
  ).id;
  s.db.update(todoTable).set({ output }).where(eq(todoTable.id, todoId)).run();
  const started = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId] },
  });
  expect(started.status).toBe(201);
  const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]!.id;
  const cred = enrolled.token;
  const claim = async () => {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred, body: {} });
    return ((await res.json()) as { step: ClaimedStep }).step;
  };
  const grant = (stepId: string, generation: number | undefined, deliverables: unknown[]) =>
    call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred,
      body: { files: [], generation, deliverables },
    });
  const put = (attachmentId: string, raw: Buffer) =>
    call(s.app, 'PUT', `/api/machine/deliverable/${attachmentId}`, { cred, raw });
  const done = (stepId: string, body: Record<string, unknown>) =>
    call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred, body });
  const rows = () => s.db.select().from(attachmentTable).all();
  return { s, cred, todoId, buildId, claim, grant, put, done, rows };
}

const PAGE = Buffer.from('<h1>结论</h1><p>Findings</p>', 'utf8');
const DECK = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('deck')]);
const pageEntry = { kind: 'page', name: 'summary.html', size: PAGE.length, sha256: sha(PAGE) };
const deckEntry = { kind: 'slides', name: 'deck.pptx', size: DECK.length, sha256: sha(DECK) };

describe('Made deliverables over the machine wire', () => {
  test('a code task claim carries no deliverable capability', async () => {
    const w = await world('code');
    expect((await w.claim()).deliverables).toBeUndefined();
  });

  test('grant, upload and done publish the verified set; the receipt then says finished', async () => {
    const w = await world();
    const claimed = await w.claim();
    const generation = claimed.deliverables!.generation;
    const grantRes = await w.grant(claimed.step.id, generation, [pageEntry, deckEntry]);
    expect(grantRes.status).toBe(200);
    const granted = ((await grantRes.json()) as { deliverables: { attachmentId: string }[] })
      .deliverables;
    expect(granted).toHaveLength(2);
    expect((await w.put(granted[0]!.attachmentId, PAGE)).status).toBe(200);
    expect((await w.put(granted[1]!.attachmentId, DECK)).status).toBe(200);
    const again = (await (
      await w.grant(claimed.step.id, generation, [pageEntry, deckEntry])
    ).json()) as { deliverables: { attachmentId: string; received: boolean }[] };
    expect(again.deliverables.map((d) => d.attachmentId)).toEqual(
      granted.map((d) => d.attachmentId),
    );
    expect(again.deliverables.every((d) => d.received)).toBe(true);
    expect(w.rows().filter((r) => r.scope === 'deliverable')).toHaveLength(2);

    const body = {
      status: 'success',
      report: '# Findings',
      generation,
      deliverables: [pageEntry, deckEntry].map(({ name, sha256 }) => ({ name, sha256 })),
    };
    expect((await w.done(claimed.step.id, body)).status).toBe(200);
    const published = w.rows().filter((r) => r.scope === 'deliverable');
    expect(published.map((r) => r.status)).toEqual(['ready', 'ready']);
    const msg = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.id, `deliverables-${w.buildId}`))
      .get()!;
    const content = JSON.parse(String(msg.content)) as { items: { kind: string }[] };
    expect(content.items.map((i) => i.kind)).toEqual(['page', 'slides']);
    const fetched = await call(w.s.app, 'GET', `/api/attachments/${granted[0]!.attachmentId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-disposition')).toBe('attachment');

    const receipt = await call(
      w.s.app,
      'GET',
      `/api/machine/steps/${claimed.step.id}/receipt?generation=${generation}`,
      { cred: w.cred },
    );
    expect(await receipt.json()).toEqual({ state: 'finished' });
    expect((await w.done(claimed.step.id, body)).status).toBe(200);
    expect(w.rows().filter((r) => r.status === 'ready')).toHaveLength(published.length + 1);
  });

  test('pending and received rows are never served', async () => {
    const w = await world();
    const claimed = await w.claim();
    const g = claimed.deliverables!.generation;
    const [row] = (
      (await (await w.grant(claimed.step.id, g, [pageEntry])).json()) as {
        deliverables: { attachmentId: string }[];
      }
    ).deliverables;
    expect((await call(w.s.app, 'GET', `/api/attachments/${row!.attachmentId}`)).status).toBe(409);
    await w.put(row!.attachmentId, PAGE);
    expect((await call(w.s.app, 'GET', `/api/attachments/${row!.attachmentId}`)).status).toBe(409);
  });

  test('a stale generation after a same-machine reclaim cannot touch the new claim', async () => {
    const w = await world();
    const first = await w.claim();
    const oldGen = first.deliverables!.generation;
    await w.grant(first.step.id, oldGen, [pageEntry]);
    w.s.db
      .update(stepTable)
      .set({ status: 'pending', machineId: null })
      .where(eq(stepTable.id, first.step.id))
      .run();
    await new Promise((r) => setTimeout(r, 5));
    const second = await w.claim();
    const newGen = second.deliverables!.generation;
    expect(newGen).not.toBe(oldGen);
    expect(
      w
        .rows()
        .filter((r) => r.scope === 'deliverable')
        .map((r) => r.status),
    ).toEqual(['failed']);
    const fresh = (
      (await (await w.grant(second.step.id, newGen, [pageEntry])).json()) as {
        deliverables: { attachmentId: string }[];
      }
    ).deliverables[0]!;
    await w.put(fresh.attachmentId, PAGE);
    expect((await w.grant(first.step.id, oldGen, [deckEntry])).status).toBe(409);
    const staleDone = await w.done(second.step.id, {
      status: 'success',
      report: '# r',
      generation: oldGen,
      deliverables: [{ name: 'missing.html', sha256: pageEntry.sha256 }],
    });
    expect(staleDone.status).toBe(409);
    const newRow = w.rows().find((r) => r.id === fresh.attachmentId)!;
    expect(newRow.status).toBe('received');
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.id, second.step.id)).get()!.status,
    ).toBe('claimed');
  });

  test('names, kinds, limits and missing generations are refused before any row exists', async () => {
    const w = await world();
    const claimed = await w.claim();
    const g = claimed.deliverables!.generation;
    const bad = [
      [{ ...pageEntry, name: '../x.html' }],
      [{ ...pageEntry, name: 'a\\b.html' }],
      [{ ...pageEntry, name: 'a\u0007.html' }],
      [{ ...pageEntry, name: 'deck.pptx' }],
      [{ ...deckEntry, name: 'page.html' }],
      [pageEntry, { ...pageEntry, name: 'SUMMARY.html' }],
      [{ ...pageEntry, size: 2 * 1024 * 1024 + 1 }],
    ];
    for (const entries of bad) {
      expect((await w.grant(claimed.step.id, g, entries)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await w.grant(claimed.step.id, undefined, [pageEntry])).status).toBe(400);
    const six = Array.from({ length: 5 }, (_, i) => ({ ...deckEntry, name: `d${i}.pptx` }));
    expect((await w.grant(claimed.step.id, g, six)).status).toBe(200);
    expect((await w.grant(claimed.step.id, g, [pageEntry])).status).toBe(400);
    expect(w.rows().filter((r) => r.scope === 'deliverable')).toHaveLength(5);
  });

  test('the claim-wide byte limit holds across repeated grants', async () => {
    const w = await world();
    const claimed = await w.claim();
    const g = claimed.deliverables!.generation;
    const big = (name: string) => ({ ...deckEntry, name, size: 20 * 1024 * 1024 });
    expect((await w.grant(claimed.step.id, g, [big('a.pptx'), big('b.pptx')])).status).toBe(200);
    expect((await w.grant(claimed.step.id, g, [big('c.pptx')])).status).toBe(413);
  });

  test('uploads that are too large, mismatched or malformed leave the row pending and no part file', async () => {
    const w = await world();
    const claimed = await w.claim();
    const g = claimed.deliverables!.generation;
    const badUtf8 = Buffer.from([0x3c, 0xff, 0xfe, 0x3e]);
    const notZip = Buffer.from('notazip!');
    const grants = (
      (await (
        await w.grant(claimed.step.id, g, [
          pageEntry,
          { kind: 'page', name: 'bad.html', size: badUtf8.length, sha256: sha(badUtf8) },
          { kind: 'slides', name: 'fake.pptx', size: notZip.length, sha256: sha(notZip) },
        ])
      ).json()) as { deliverables: { attachmentId: string }[] }
    ).deliverables;
    expect((await w.put(grants[0]!.attachmentId, Buffer.concat([PAGE, PAGE]))).status).toBe(413);
    expect((await w.put(grants[0]!.attachmentId, Buffer.from(PAGE).fill(0x61))).status).toBe(422);
    expect((await w.put(grants[1]!.attachmentId, badUtf8)).status).toBe(422);
    expect((await w.put(grants[2]!.attachmentId, notZip)).status).toBe(422);
    expect(w.rows().every((r) => r.scope !== 'deliverable' || r.status === 'pending')).toBe(true);
    const teamDir = join(w.s.attachmentsDir, w.s.team.id);
    const leftovers = existsSync(teamDir) ? readdirSync(teamDir) : [];
    expect(leftovers).toEqual([]);
  });

  test('a done that names a file never received fails the step and publishes nothing', async () => {
    const w = await world();
    const claimed = await w.claim();
    const g = claimed.deliverables!.generation;
    await w.grant(claimed.step.id, g, [pageEntry]);
    const res = await w.done(claimed.step.id, {
      status: 'success',
      report: '# r',
      generation: g,
      deliverables: [{ name: pageEntry.name, sha256: pageEntry.sha256 }],
    });
    expect(res.status).toBe(200);
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get()!.status,
    ).toBe('failed');
    expect(w.rows().find((r) => r.scope === 'deliverable')!.status).toBe('failed');
    expect(
      w.s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.id, `deliverables-${w.buildId}`))
        .get(),
    ).toBeUndefined();
  });

  test('a stopped step fails its uploaded rows', async () => {
    const w = await world();
    const claimed = await w.claim();
    const g = claimed.deliverables!.generation;
    const [row] = (
      (await (await w.grant(claimed.step.id, g, [pageEntry])).json()) as {
        deliverables: { attachmentId: string }[];
      }
    ).deliverables;
    await w.put(row!.attachmentId, PAGE);
    expect((await w.done(claimed.step.id, { status: 'stopped' })).status).toBe(200);
    expect(w.rows().find((r) => r.id === row!.attachmentId)!.status).toBe('failed');
  });

  test('deleting the todo retires its published set and message at once', async () => {
    const w = await world();
    const claimed = await w.claim();
    const g = claimed.deliverables!.generation;
    const [row] = (
      (await (await w.grant(claimed.step.id, g, [pageEntry])).json()) as {
        deliverables: { attachmentId: string }[];
      }
    ).deliverables;
    await w.put(row!.attachmentId, PAGE);
    await w.done(claimed.step.id, {
      status: 'success',
      report: '# r',
      generation: g,
      deliverables: [{ name: pageEntry.name, sha256: pageEntry.sha256 }],
    });
    expect(w.rows().find((r) => r.id === row!.attachmentId)!.status).toBe('ready');
    deleteTodo({ db: w.s.db, hub: w.s.hub, user: w.s.user } as never, w.todoId);
    expect(w.rows().find((r) => r.id === row!.attachmentId)!.status).toBe('failed');
    expect(
      w.s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.id, `deliverables-${w.buildId}`))
        .get(),
    ).toBeUndefined();
  });
});

describe('attachment GC ownership', () => {
  test('a failed unlink keeps the row so the next sweep retries', () => {
    const s = bootServer();
    const key = `${s.team.id}/gc-1.html`;
    const abs = join(s.attachmentsDir, key);
    mkdirSync(join(abs, 'blocker'), { recursive: true });
    s.db
      .insert(attachmentTable)
      .values({
        id: 'gc-1',
        teamId: s.team.id,
        createdBy: s.user.id,
        fileName: 'x.html',
        mimeType: 'text/html',
        sizeBytes: 1,
        storageKey: key,
        grantId: 'deliverable:s:1',
        scope: 'deliverable',
        status: 'failed',
        createdAt: Date.now() - 2 * DAY,
      })
      .run();
    const deps = { db: s.db, attachmentsDir: s.attachmentsDir, logger: silent };
    sweepAttachments(deps);
    expect(
      s.db.select().from(attachmentTable).where(eq(attachmentTable.id, 'gc-1')).get(),
    ).toBeDefined();
    rmSync(abs, { recursive: true });
    sweepAttachments(deps);
    expect(
      s.db.select().from(attachmentTable).where(eq(attachmentTable.id, 'gc-1')).get(),
    ).toBeUndefined();
  });

  test('part files older than the grace are swept and fresh ones kept', () => {
    const s = bootServer();
    const old = join(s.attachmentsDir, s.team.id, 'a.html.part-0123456789abcdef');
    const fresh = join(s.attachmentsDir, s.team.id, 'b.html.part-fedcba9876543210');
    mkdirSync(dirname(old), { recursive: true });
    writeFileSync(old, 'x');
    writeFileSync(fresh, 'y');
    const past = (Date.now() - 31 * 60 * 1000) / 1000;
    utimesSync(old, past, past);
    expect(sweepUploadParts({ attachmentsDir: s.attachmentsDir, logger: silent })).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

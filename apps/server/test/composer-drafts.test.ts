import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  attachment as attachmentTable,
  composerDraft,
  project as projectTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { ATTACHMENT_ORPHAN_GRACE_MS, sweepAttachments } from '../src/services/attachment-gc.js';
import {
  COMPOSER_DRAFT_IDLE_TTL_MS,
  COMPOSER_DRAFT_MAX_CHARS,
  sweepIdleComposerDrafts,
} from '../src/services/composer-drafts.js';
import { bootServer, req, type TestServer } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'cairn-test-token-0123456789abcdef';

let server: TestServer | null = null;
afterEach(() => {
  server?.dispose();
  server = null;
});

function boot(opts: Parameters<typeof bootServer>[0] = {}): TestServer {
  server = bootServer(opts);
  return server;
}

interface Snapshot {
  content: string;
  updatedAt: number | null;
}

function draftPath(s: TestServer, scope: string): string {
  return `/api/teams/${s.team.id}/drafts/${scope}`;
}

async function read(s: TestServer, scope: string): Promise<Snapshot> {
  const res = await req(s.app, 'GET', draftPath(s, scope));
  expect(res.status).toBe(200);
  return (await res.json()) as Snapshot;
}

async function write(s: TestServer, scope: string, content: string): Promise<Snapshot> {
  const res = await req(s.app, 'PUT', draftPath(s, scope), { content });
  expect(res.status).toBe(200);
  return (await res.json()) as Snapshot;
}

function putReadyAttachment(s: TestServer, createdAgo: number): { id: string; key: string } {
  const id = newRecordId();
  const key = `${s.team.id}/${id}.md`;
  s.db
    .insert(attachmentTable)
    .values({
      id,
      teamId: s.team.id,
      createdBy: s.user.id,
      fileName: 'note.md',
      mimeType: 'text/markdown',
      sizeBytes: 8,
      storageKey: key,
      grantId: newRecordId(),
      scope: 'message',
      status: 'ready',
      createdAt: Date.now() - createdAgo,
    })
    .run();
  mkdirSync(join(s.attachmentsDir, s.team.id), { recursive: true });
  writeFileSync(join(s.attachmentsDir, key), '# hello\n');
  return { id, key };
}

function gc(s: TestServer, now = Date.now()) {
  return sweepAttachments(
    { db: s.db, attachmentsDir: s.attachmentsDir, logger: { info() {}, debug() {} } },
    now,
  );
}

describe('composer drafts: persistence across reloads and devices', () => {
  test('no draft yet -> empty snapshot with null updatedAt', async () => {
    const s = boot();
    expect(await read(s, 'chief')).toEqual({ content: '', updatedAt: null });
  });

  test('text and attachment tokens written by one device are read back by another', async () => {
    const s = boot();
    const content = '![shot.png](attachment:team/abc.png)\nlook at this\n第二行';
    const saved = await write(s, 'chief', content);
    expect(saved.content).toBe(content);
    expect(typeof saved.updatedAt).toBe('number');
    expect(await read(s, 'chief')).toEqual(saved);
  });

  test('scopes are independent: the Coordinator draft and each thread draft', async () => {
    const s = boot();
    await write(s, 'chief', 'coordinator text');
    await write(s, 'todo:t1', 'thread one');
    await write(s, 'todo:t2', 'thread two');
    expect((await read(s, 'chief')).content).toBe('coordinator text');
    expect((await read(s, 'todo:t1')).content).toBe('thread one');
    expect((await read(s, 'todo:t2')).content).toBe('thread two');
  });

  test('a draft written for an archived thread is still served', async () => {
    const s = boot();
    const projectId = 'p1';
    s.db.insert(projectTable).values({ id: projectId, name: 'arch', teamId: s.team.id }).run();
    s.db
      .insert(todoTable)
      .values({
        id: 't-arch',
        teamId: s.team.id,
        projectId,
        title: 'old',
        spec: '',
        phaseAt: 1,
        seqNum: 1,
        archivedAt: 5,
      })
      .run();
    await write(s, 'todo:t-arch', 'unsent reply');
    expect((await read(s, 'todo:t-arch')).content).toBe('unsent reply');
  });
});

describe('composer drafts: two devices typing', () => {
  test('last writer wins and updatedAt strictly increases even inside one millisecond', async () => {
    const s = boot();
    const a = await write(s, 'chief', 'from device A');
    const b = await write(s, 'chief', 'from device B');
    expect(b.updatedAt as number).toBeGreaterThan(a.updatedAt as number);
    expect((await read(s, 'chief')).content).toBe('from device B');
  });
});

describe('composer drafts: clearing', () => {
  test('writing the empty string after a successful send removes the draft for every device', async () => {
    const s = boot();
    await write(s, 'chief', 'about to send');
    expect(await write(s, 'chief', '')).toEqual({ content: '', updatedAt: null });
    expect(await read(s, 'chief')).toEqual({ content: '', updatedAt: null });
    expect(s.db.select().from(composerDraft).all()).toHaveLength(0);
  });
});

describe('composer drafts: validation and auth', () => {
  test('content over the limit is rejected and the previous draft is kept', async () => {
    const s = boot();
    await write(s, 'chief', 'keep me');
    const res = await req(s.app, 'PUT', draftPath(s, 'chief'), {
      content: 'x'.repeat(COMPOSER_DRAFT_MAX_CHARS + 1),
    });
    expect(res.status).toBe(400);
    expect((await read(s, 'chief')).content).toBe('keep me');
  });

  test('content exactly at the limit is accepted', async () => {
    const s = boot();
    const res = await req(s.app, 'PUT', draftPath(s, 'chief'), {
      content: 'x'.repeat(COMPOSER_DRAFT_MAX_CHARS),
    });
    expect(res.status).toBe(200);
  });

  test('an unknown scope is rejected', async () => {
    const s = boot();
    expect((await req(s.app, 'GET', draftPath(s, 'other'))).status).toBe(400);
    expect((await req(s.app, 'PUT', draftPath(s, 'todo:a.b'), { content: 'x' })).status).toBe(400);
  });

  test('another team id is 404', async () => {
    const s = boot();
    const res = await req(s.app, 'GET', '/api/teams/not-my-team/drafts/chief');
    expect(res.status).toBe(404);
  });

  test('with the owner token on: 401 without it, 200 with it', async () => {
    const s = boot({ authToken: TOKEN });
    const anon = await req(s.app, 'GET', draftPath(s, 'chief'));
    expect(anon.status).toBe(401);
    const anonPut = await req(s.app, 'PUT', draftPath(s, 'chief'), { content: 'x' });
    expect(anonPut.status).toBe(401);
    const authed = await s.app.request(draftPath(s, 'chief'), {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(authed.status).toBe(200);
  });
});

describe('composer drafts: attachment reclaim (spec 20 R6)', () => {
  test('an attachment referenced by a draft survives the orphan sweep past grace', async () => {
    const s = boot();
    const { id, key } = putReadyAttachment(s, ATTACHMENT_ORPHAN_GRACE_MS + DAY);
    await write(s, 'chief', `![note.md](attachment:${key})\ntext`);
    expect(gc(s).orphan).toBe(0);
    expect(
      s.db.select().from(attachmentTable).where(eq(attachmentTable.id, id)).get(),
    ).toBeDefined();
    expect(existsSync(join(s.attachmentsDir, key))).toBe(true);
  });

  test('removing the token from the draft makes the attachment reclaimable', async () => {
    const s = boot();
    const { id, key } = putReadyAttachment(s, ATTACHMENT_ORPHAN_GRACE_MS + DAY);
    await write(s, 'chief', `![note.md](attachment:${key})\ntext`);
    await write(s, 'chief', 'text');
    expect(gc(s).orphan).toBe(1);
    expect(
      s.db.select().from(attachmentTable).where(eq(attachmentTable.id, id)).get(),
    ).toBeUndefined();
    expect(existsSync(join(s.attachmentsDir, key))).toBe(false);
  });

  test('clearing the draft after send leaves a reference only if the sent message holds it', async () => {
    const s = boot();
    const { key } = putReadyAttachment(s, ATTACHMENT_ORPHAN_GRACE_MS + DAY);
    await write(s, 'chief', `![note.md](attachment:${key})`);
    await write(s, 'chief', '');
    expect(gc(s).orphan).toBe(1);
  });

  test('a draft idle past the TTL is deleted, a fresh one is kept', () => {
    const s = boot();
    const now = Date.now();
    for (const [scope, updatedAt] of [
      ['todo:old', now - COMPOSER_DRAFT_IDLE_TTL_MS - DAY],
      ['todo:fresh', now - DAY],
    ] as const) {
      s.db
        .insert(composerDraft)
        .values({
          id: newRecordId(),
          teamId: s.team.id,
          userId: s.user.id,
          scope,
          content: scope,
          updatedAt,
        })
        .run();
    }
    expect(sweepIdleComposerDrafts(s.db, now)).toBe(1);
    expect(
      s.db
        .select()
        .from(composerDraft)
        .all()
        .map((r) => r.scope),
    ).toEqual(['todo:fresh']);
  });
});

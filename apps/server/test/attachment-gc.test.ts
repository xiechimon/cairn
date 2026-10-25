import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  attachment as attachmentTable,
  build as buildTable,
  chiefMessage as chiefMessageTable,
  chiefThread as chiefThreadTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  steerPending as steerPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import {
  ATTACHMENT_ORPHAN_GRACE_MS,
  ATTACHMENT_PENDING_TTL_MS,
  type GcLogger,
  sweepAttachments,
  TEAM_ATTACHMENTS_QUOTA_BYTES,
} from '../src/services/attachment-gc.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const DAY = 24 * 60 * 60 * 1000;

function makeLogger(): GcLogger & { infos: string[]; debugs: string[] } {
  const infos: string[] = [];
  const debugs: string[] = [];
  return {
    infos,
    debugs,
    info: (_meta: unknown, msg: string) => {
      infos.push(msg);
    },
    debug: (_meta: unknown, msg: string) => {
      debugs.push(msg);
    },
  };
}

function putAttachment(
  s: TestServer,
  opts: {
    status?: 'pending' | 'ready';
    createdAgo?: number;
    fileName?: string;
    bytes?: Uint8Array;
    scope?: 'spec' | 'message';
  } = {},
): { id: string; key: string } {
  const id = newRecordId();
  const fileName = opts.fileName ?? 'note.md';
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : 'md';
  const key = `${s.team.id}/${id}.${ext}`;
  const bytes = opts.bytes ?? new TextEncoder().encode('# hello\n');
  s.db
    .insert(attachmentTable)
    .values({
      id,
      teamId: s.team.id,
      createdBy: s.user.id,
      fileName,
      mimeType: 'text/markdown',
      sizeBytes: bytes.byteLength,
      storageKey: key,
      grantId: newRecordId(),
      scope: opts.scope ?? 'message',
      status: opts.status ?? 'ready',
      createdAt: Date.now() - (opts.createdAgo ?? 0),
    })
    .run();
  if ((opts.status ?? 'ready') === 'ready') {
    mkdirSync(join(s.attachmentsDir, s.team.id), { recursive: true });
    writeFileSync(join(s.attachmentsDir, key), bytes);
  }
  return { id, key };
}

function tokenFor(fileName: string, key: string): string {
  return `![${fileName}](attachment:${key})`;
}

function putTodo(s: TestServer, spec: string): string {
  const todoId = newRecordId();
  const projectId = newRecordId();
  s.db.insert(projectTable).values({ id: projectId, name: 'gc', teamId: s.team.id }).run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'gc target',
      spec,
      phaseAt: Date.now(),
      seqNum: 1,
    })
    .run();
  return todoId;
}

function rowOf(s: TestServer, id: string) {
  return s.db.select().from(attachmentTable).where(eq(attachmentTable.id, id)).get();
}

describe('attachment gc -- unreferenced ready items', () => {
  test('past grace -> file + row collected, stats record orphan + bytes', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const log = makeLogger();
    const { id, key } = putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: log },
      Date.now(),
    );
    expect(stats.orphan).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.reclaimedBytes).toBeGreaterThan(0);
    expect(rowOf(s, id)).toBeUndefined();
    expect(existsSync(join(s.attachmentsDir, key))).toBe(false);
    expect(log.infos.length).toBeGreaterThanOrEqual(1);
  });

  test('within grace -> kept (file + row both present, stats all zero)', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const log = makeLogger();
    const { id, key } = putAttachment(s, { createdAgo: DAY });
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: log },
      Date.now(),
    );
    expect(stats.orphan).toBe(0);
    expect(stats.pending).toBe(0);
    expect(rowOf(s, id)).toBeTruthy();
    expect(existsSync(join(s.attachmentsDir, key))).toBe(true);
  });
});

describe('attachment gc -- anything referenced is kept', () => {
  test('todo.spec whole-line token reference -> untouched', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id, key } = putAttachment(s, {
      createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY,
    });
    putTodo(s, `需求正文\n${tokenFor('note.md', key)}\n`);
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.orphan).toBe(0);
    expect(rowOf(s, id)).toBeTruthy();
    expect(existsSync(join(s.attachmentsDir, key))).toBe(true);
  });

  test('reference inside message.content JSON -> untouched', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id, key } = putAttachment(s, {
      createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY,
    });
    s.db
      .insert(messageTable)
      .values({
        id: newRecordId(),
        conversationId: 'conv-gc',
        role: 'user',
        content: { text: `看这张图\n${tokenFor('note.md', key)}` },
        createdAt: Date.now(),
      })
      .run();
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.orphan).toBe(0);
    expect(rowOf(s, id)).toBeTruthy();
  });

  test('inline token (not whole-line shape) -> still counts as a reference, untouched', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id } = putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    putTodo(s, `正文里顺手一提 ${tokenFor('note.md', `${s.team.id}/${id}.md`)} 别删`);
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.orphan).toBe(0);
    expect(rowOf(s, id)).toBeTruthy();
  });

  test('chief_message reference -> untouched', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id, key } = putAttachment(s, {
      createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY,
    });
    const threadId = `chief-${newRecordId()}`;
    s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId: `chief-${s.user.id}-${s.team.id}`,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'gc thread',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'sess-gc',
        sessionOpenedAt: Date.now(),
      })
      .run();
    s.db
      .insert(chiefMessageTable)
      .values({
        id: newRecordId(),
        threadId,
        role: 'user',
        content: { text: tokenFor('note.md', key) },
        createdAt: Date.now(),
      })
      .run();
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.orphan).toBe(0);
    expect(rowOf(s, id)).toBeTruthy();
  });

  test('steer_pending / plan reference -> untouched', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const a = putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    const b = putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    s.db
      .insert(steerPendingTable)
      .values({
        conversationId: 'conv-steer',
        stepId: 'step-steer',
        content: `补充说明 ${tokenFor('a.md', a.key)}`,
        createdAt: Date.now(),
      })
      .run();
    const todoId = putTodo(s, 'plan host');
    const buildId = newRecordId();
    s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: true,
        triggerSource: 'user',
        createdAt: Date.now(),
      })
      .run();
    s.db
      .insert(planTable)
      .values({
        id: newRecordId(),
        buildId,
        version: 1,
        content: `方案\n${tokenFor('b.md', b.key)}`,
        createdAt: Date.now(),
      })
      .run();
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.orphan).toBe(0);
    expect(rowOf(s, a.id)).toBeTruthy();
    expect(rowOf(s, b.id)).toBeTruthy();
  });
});

describe('attachment gc -- delete-task semantics (R1)', () => {
  test('deleting the task itself does not touch attachments; orphans collected after grace', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id, key } = putAttachment(s, {
      createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY,
    });
    const todoId = putTodo(s, `带图任务\n${tokenFor('note.md', key)}\n`);
    const { deleteTodo } = await import('../src/services/todos.js');
    const deleted = deleteTodo({ db: s.db, hub: s.hub, user: s.user }, todoId);
    expect(deleted).toBe(true);
    expect(rowOf(s, id)).toBeTruthy();
    expect(existsSync(join(s.attachmentsDir, key))).toBe(true);
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.orphan).toBe(1);
    expect(rowOf(s, id)).toBeUndefined();
  });

  test('task deleted but attachment still referenced elsewhere -> untouched', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id } = putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    const todoId = putTodo(s, `任务A\n${tokenFor('note.md', `${s.team.id}/${id}.md`)}\n`);
    putTodo(s, `任务B转发的同一张图\n${tokenFor('note.md', `${s.team.id}/${id}.md`)}\n`);
    const { deleteTodo } = await import('../src/services/todos.js');
    deleteTodo({ db: s.db, hub: s.hub, user: s.user }, todoId);
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.orphan).toBe(0);
    expect(rowOf(s, id)).toBeTruthy();
  });
});

describe('attachment gc -- pending items', () => {
  test('pending past 24h -> row collected (no file, no reference, grant dead)', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id } = putAttachment(s, {
      status: 'pending',
      createdAgo: ATTACHMENT_PENDING_TTL_MS + DAY,
    });
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.pending).toBe(1);
    expect(stats.orphan).toBe(0);
    expect(rowOf(s, id)).toBeUndefined();
  });

  test('fresh pending -> kept (upload in flight)', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const { id } = putAttachment(s, { status: 'pending', createdAgo: 60_000 });
    const stats = sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: makeLogger() },
      Date.now(),
    );
    expect(stats.pending).toBe(0);
    expect(rowOf(s, id)).toBeTruthy();
  });
});

describe('attachment gc -- quota (R4: admission gate, referenced items not deleted)', () => {
  test('grant -> 400 when team usage is at 1GiB; old items unaffected', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    s.db
      .insert(attachmentTable)
      .values({
        id: newRecordId(),
        teamId: s.team.id,
        createdBy: s.user.id,
        fileName: 'hog.bin',
        mimeType: 'text/plain',
        sizeBytes: TEAM_ATTACHMENTS_QUOTA_BYTES,
        storageKey: `${s.team.id}/${newRecordId()}.txt`,
        grantId: newRecordId(),
        scope: 'message',
        status: 'ready',
        createdAt: Date.now(),
      })
      .run();
    const res = await req(s.app, 'POST', '/api/uploads/grant', {
      kind: 'attachment',
      fileName: 'one-more.md',
      mimeType: 'text/markdown',
      size: 8,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/quota/);
  });
});

describe('attachment gc -- scheduler cadence', () => {
  test('scheduler lookup plans use indexes for bounded tick scans', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const schedulePlan = s.db.all(
      sql`EXPLAIN QUERY PLAN SELECT * FROM schedule WHERE nextRunAt IS NOT NULL AND nextRunAt <= 1`,
    ) as Array<{ detail: string }>;
    const notificationPlan = s.db.all(
      sql`EXPLAIN QUERY PLAN SELECT notification.id FROM notification INNER JOIN chief_thread ON notification.entityId = chief_thread.id WHERE notification.type = 'chief_message' AND notification.readAt IS NULL`,
    ) as Array<{ detail: string }>;
    expect(schedulePlan.some((row) => row.detail.includes('schedule_nextRunAt_idx'))).toBe(true);
    expect(
      notificationPlan.some((row) => row.detail.includes('notification_type_readAt_idx')),
    ).toBe(true);
  });

  test('a large transcript corpus does not block the event loop during a tick', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const threadId = 'chief-gc-large';
    s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId: `chief-${s.user.id}-${s.team.id}`,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Large corpus',
        createdAt: 0,
        updatedAt: 0,
        sessionId: '',
        sessionOpenedAt: 0,
      })
      .run();
    const rows = Array.from({ length: 100_000 }, (_, index) => ({
      id: `message-gc-${index}`,
      conversationId: 'build-gc',
      role: 'assistant' as const,
      content: { text: 'x'.repeat(256) },
      createdAt: index,
      actor: null,
    }));
    for (let offset = 0; offset < rows.length; offset += 1_000) {
      const batch = rows.slice(offset, offset + 1_000);
      s.db.insert(messageTable).values(batch).run();
      s.db
        .insert(chiefMessageTable)
        .values(
          batch.map((row) => ({
            id: `chief-message-${row.id}`,
            threadId,
            role: row.role,
            content: row.content,
            createdAt: row.createdAt,
          })),
        )
        .run();
    }
    const indexedQueries = [
      'SELECT * FROM schedule WHERE nextRunAt IS NOT NULL AND nextRunAt <= 1',
      "SELECT notification.id FROM notification INNER JOIN chief_thread ON notification.entityId = chief_thread.id WHERE notification.type = 'chief_message' AND notification.readAt IS NULL",
      'SELECT id FROM machine WHERE online = 1 AND lastSeenAt IS NOT NULL AND lastSeenAt < 1',
      "SELECT * FROM step WHERE kind = 'chief'",
      "SELECT step.id FROM step INNER JOIN build ON step.buildId = build.id INNER JOIN todo ON build.todoId = todo.id WHERE todo.phase IN ('closed', 'done') AND step.status IN ('pending', 'waiting_quota')",
      "SELECT * FROM step WHERE kind IN ('plan', 'build', 'merge', 'review', 'verify') AND status IN ('pending', 'claimed')",
      "SELECT * FROM todo WHERE phase = 'queued'",
      "SELECT id FROM step WHERE buildId = 'missing' AND status IN ('pending', 'claimed', 'waiting_quota')",
      "SELECT * FROM step WHERE status = 'waiting_quota'",
      "SELECT id FROM step WHERE id = 'missing'",
    ];
    for (const query of indexedQueries) {
      const plan = s.db.all<{ detail: string }>(sql.raw(`EXPLAIN QUERY PLAN ${query}`));
      expect(
        plan.some((row) => row.detail.includes('SCAN')),
        query,
      ).toBe(false);
    }
    for (const source of [
      { table: 'todo', cursor: 'id', content: 'spec' },
      { table: 'message', cursor: 'id', content: 'content' },
      { table: 'chief_message', cursor: 'id', content: 'content' },
      { table: 'steer_pending', cursor: 'conversationId', content: 'content' },
      { table: 'plan', cursor: 'id', content: 'content' },
    ]) {
      const plan = s.db.all<{ detail: string }>(
        sql.raw(
          `EXPLAIN QUERY PLAN SELECT ${source.cursor}, ${source.content} FROM ${source.table} WHERE ${source.cursor} > 'cursor' ORDER BY ${source.cursor} LIMIT 128`,
        ),
      );
      expect(
        plan.some((row) => row.detail.includes('SEARCH')),
        source.table,
      ).toBe(true);
      expect(
        plan.some((row) => row.detail.includes('TEMP B-TREE')),
        source.table,
      ).toBe(false);
    }
    const logger = makeLogger();
    const orphan = putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    const scheduler = createScheduler(
      { db: s.db, hub: s.hub, user: s.user },
      { tickMs: 15_000 },
      { attachmentsDir: s.attachmentsDir, logger },
    );
    const server = createServer((_request, response) => {
      void Promise.resolve(s.app.request('/api/projects')).then(async (result) => {
        response.writeHead(result.status);
        response.end(await result.text());
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
      const startedAt = performance.now();
      const response = fetch(`http://127.0.0.1:${address.port}/api/projects`);
      const tickAt = performance.now();
      scheduler.tick(Date.now());
      const tickMs = performance.now() - tickAt;
      expect((await response).status).toBe(200);
      expect(tickMs).toBeLessThan(100);
      expect(performance.now() - startedAt).toBeLessThan(250);
      expect(logger.infos.some((line) => line.startsWith('attachment gc:'))).toBe(false);
      const referenced = putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
      s.db
        .insert(messageTable)
        .values({
          id: 'message-gc-new-reference',
          conversationId: 'build-gc',
          role: 'user',
          content: { text: tokenFor('note.md', referenced.key) },
          createdAt: Date.now(),
        })
        .run();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(logger.infos).toContain('attachment gc deferred after database writes');
      expect(rowOf(s, referenced.id)).toBeTruthy();
      scheduler.tick(Date.now() + 61 * 60_000);
      for (let attempt = 0; attempt < 5_000; attempt += 1) {
        if (logger.infos.some((line) => line.startsWith('attachment gc:'))) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(logger.infos.some((line) => line.startsWith('attachment gc:'))).toBe(true);
      expect(rowOf(s, referenced.id)).toBeTruthy();
      expect(rowOf(s, orphan.id)).toBeUndefined();
      expect(
        logger.infos.some((line) => line.startsWith('attachment gc: 0 pending, 1 orphan,')),
      ).toBe(true);
      scheduler.stop();
    } finally {
      scheduler.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 30_000);

  test('first tick scans; no rescan within 1h; scans again after 1h', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const infos: string[] = [];
    const logger = {
      info: (_m: unknown, msg: string) => {
        infos.push(msg);
      },
      debug: () => {},
    };
    const base = Date.now();
    putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    const scheduler = createScheduler(
      { db: s.db, hub: s.hub, user: s.user },
      { tickMs: 15_000 },
      { attachmentsDir: s.attachmentsDir, logger },
    );
    scheduler.tick(base);
    expect(
      s.db
        .select()
        .from(attachmentTable)
        .all()
        .filter((r) => r.status === 'ready'),
    ).toHaveLength(0);
    putAttachment(s, { createdAgo: ATTACHMENT_ORPHAN_GRACE_MS + DAY });
    scheduler.tick(base + 60_000);
    expect(
      s.db
        .select()
        .from(attachmentTable)
        .all()
        .filter((r) => r.status === 'ready'),
    ).toHaveLength(1);
    scheduler.tick(base + 61 * 60_000);
    expect(
      s.db
        .select()
        .from(attachmentTable)
        .all()
        .filter((r) => r.status === 'ready'),
    ).toHaveLength(0);
    scheduler.stop();
  });
});

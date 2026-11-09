import { MEMORY_INDEX_TITLE } from '@cairn/shared';
import { eq, isNull } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import type { Db } from '../src/db/client.js';
import { openMemoryDb } from '../src/db/client.js';
import { agentMemory } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import {
  foldMemoryIndexes,
  MEMORY_VERSION_RETENTION_MS,
  purgeExpiredMemoryVersions,
} from '../src/services/memory.js';

const TEAM = 'team-1';
const AGENT = 'agent-1';
const PROJECT = 'project-1';
const DAY = 24 * 60 * 60 * 1000;

function insert(db: Db, over: Partial<typeof agentMemory.$inferInsert>): string {
  const id = newRecordId();
  db.insert(agentMemory)
    .values({
      id,
      agentId: AGENT,
      teamId: TEAM,
      title: 'title',
      content: 'content',
      projectId: null,
      sourceTodoId: null,
      sourceBuildId: null,
      createdAt: 1_000,
      updatedAt: 1_000,
      ...over,
    })
    .run();
  return id;
}

function valid(db: Db) {
  return db.select().from(agentMemory).where(isNull(agentMemory.invalidAt)).all();
}

function indexOf(db: Db, projectId: string | null) {
  return valid(db).filter(
    (row) =>
      row.layer === 'core' && row.projectId === projectId && row.title === MEMORY_INDEX_TITLE,
  );
}

describe('MEMORY.md fold of legacy rows', () => {
  test('folds valid core rows per scope into one MEMORY.md and keeps the old rows as superseded versions', () => {
    const db = openMemoryDb();
    const a = insert(db, { title: '验证命令', content: '推送前跑受影响的测试', createdAt: 1 });
    const b = insert(db, { title: '评审交接', content: '写清验收证据', createdAt: 2 });
    const p = insert(db, { title: '无障碍', content: '检查焦点顺序', projectId: PROJECT });
    insert(db, { title: '旧事实', content: '已失效', invalidAt: 5 });

    foldMemoryIndexes(db, 10_000);

    const team = indexOf(db, null);
    expect(team).toHaveLength(1);
    expect(team[0]?.content).toBe('- 验证命令：推送前跑受影响的测试\n- 评审交接：写清验收证据');
    expect(indexOf(db, PROJECT)[0]?.content).toBe('- 无障碍：检查焦点顺序');
    for (const id of [a, b, p]) {
      const row = db.select().from(agentMemory).where(eq(agentMemory.id, id)).get();
      expect(row?.invalidAt).toBe(10_000);
      expect(row?.supersededBy).toBe(
        row?.projectId === null ? team[0]?.id : indexOf(db, PROJECT)[0]?.id,
      );
    }
  });

  test('spills a multi-line core row into a memory file and points to it from MEMORY.md', () => {
    const db = openMemoryDb();
    insert(db, { title: '发布交接', content: '记录部署版本\n- 写明提交\n- 附截图' });

    foldMemoryIndexes(db, 10_000);

    const file = valid(db).find((row) => row.layer === 'searchable');
    expect(file).toMatchObject({
      title: '发布交接',
      content: '记录部署版本\n- 写明提交\n- 附截图',
    });
    expect(indexOf(db, null)[0]?.content).toBe(
      '- 发布交接：记录部署版本（详见记忆文件「发布交接」）',
    );
  });

  test('turns log rows into memory files and leaves scratchpads and independent scopes apart', () => {
    const db = openMemoryDb();
    const log = insert(db, { title: '周报', content: '本周发布两次', layer: 'log' as never });
    const pad = insert(db, {
      title: '草稿',
      content: '待整理',
      layer: 'scratchpad',
      threadId: 't1',
    });
    insert(db, { title: '独立', content: '自己的', independent: true, agentId: 'agent-2' });

    foldMemoryIndexes(db, 10_000);

    expect(db.select().from(agentMemory).where(eq(agentMemory.id, log)).get()?.layer).toBe(
      'searchable',
    );
    expect(
      db.select().from(agentMemory).where(eq(agentMemory.id, pad)).get()?.invalidAt,
    ).toBeNull();
    const independent = valid(db).filter((row) => row.independent);
    expect(independent).toHaveLength(1);
    expect(independent[0]).toMatchObject({ title: MEMORY_INDEX_TITLE, agentId: 'agent-2' });
    expect(indexOf(db, null).filter((row) => !row.independent)).toHaveLength(0);
  });

  test('is idempotent: a second run changes nothing', () => {
    const db = openMemoryDb();
    insert(db, { title: '验证命令', content: '推送前跑受影响的测试' });
    foldMemoryIndexes(db, 10_000);
    const before = db.select().from(agentMemory).all();
    foldMemoryIndexes(db, 20_000);
    expect(db.select().from(agentMemory).all()).toEqual(before);
  });
});

describe('version retention', () => {
  test('purges versions superseded more than 90 days ago and trims old history entries', () => {
    const db = openMemoryDb();
    const now = 400 * DAY;
    const oldVersion = insert(db, { invalidAt: now - MEMORY_VERSION_RETENTION_MS - 1 });
    const recentVersion = insert(db, { invalidAt: now - DAY });
    const live = insert(db, {
      title: MEMORY_INDEX_TITLE,
      createdAt: now - DAY,
      updatedAt: now - DAY,
      history: [
        { title: MEMORY_INDEX_TITLE, content: 'v1', updatedAt: now - 200 * DAY },
        { title: MEMORY_INDEX_TITLE, content: 'v2', updatedAt: now - 100 * DAY },
        { title: MEMORY_INDEX_TITLE, content: 'v3', updatedAt: now - 10 * DAY },
      ],
    });

    purgeExpiredMemoryVersions(db, now);

    const ids = db
      .select({ id: agentMemory.id })
      .from(agentMemory)
      .all()
      .map((row) => row.id);
    expect(ids).not.toContain(oldVersion);
    expect(ids).toContain(recentVersion);
    expect(
      db
        .select()
        .from(agentMemory)
        .where(eq(agentMemory.id, live))
        .get()
        ?.history.map((entry) => entry.content),
    ).toEqual(['v2', 'v3']);
  });
});

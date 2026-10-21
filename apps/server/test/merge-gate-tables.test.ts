// #1404 S3：合并就绪闸的四张 server 表（gate_digest / gate_round / gate_verdict /
// gate_state）的迁移。约束在库里成立才算数，故断言走迁移后的真库（原生 SQL 读写），
// 不只看 drizzle 对象。
//
// 失败方式（先于实现固化，全文 docs/verify/1404/s3-failure-modes.txt，下文按号引用）：
// F1 旧库升级不应用本迁移（journal 的 when 不大于库里最新一条即被静默跳过）。
// F2 同一构建同一摘要两轮。F3 同一构建两轮同号。F4 同一步两条判定。
// F5 判定指向不存在的步或构建。F6 删构建留下孤儿行。F7 闸行挡住现有删除路径。
// F8 摘要为空（head 对不上）的判定存不进。F9 chief 小合并步的判定挂不到被审构建。
// F10 同一构建两份快照。F11 blockers JSON 往返失真。F12 同一 head 两份摘要。
// F14 共享表清单漏登记。F15 机器回传路径写判定。F16 迁移按序号定位（合并期重编号即坏）。
// F13（schema 与迁移漂移）由 drizzle-kit generate 空转与 db:check 两道闸钉住，不在本文件。

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DB_TABLES, INTERNAL_ONLY_TABLES, todoRecordSchema } from '@pacman/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { type Db, MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { startBuilds } from '../src/services/builds.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

const GATE_TABLES = ['gate_digest', 'gate_round', 'gate_verdict', 'gate_state'] as const;
const D1 = `pd2:${'a'.repeat(64)}`;
const D2 = `pd2:${'b'.repeat(64)}`;
const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);

const temps: string[] = [];
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Row = Record<string, string | number | null>;

/** 原生插行：列名取对象键，值原样绑定（JSON 列由调用方先序列化）。 */
function insert(sqlite: Database.Database, table: string, row: Row): void {
  const cols = Object.keys(row);
  sqlite
    .prepare(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
        .map(() => '?')
        .join(', ')})`,
    )
    .run(...cols.map((c) => row[c]));
}

function count(sqlite: Database.Database, table: string, buildId: string): number {
  return (
    sqlite.prepare(`SELECT count(*) AS n FROM "${table}" WHERE "buildId" = ?`).get(buildId) as {
      n: number;
    }
  ).n;
}

/** 种一个 project → todo → build → worker step（列取各表的必填最小集）。 */
function seedBuild(sqlite: Database.Database, teamId: string, suffix: string) {
  const ids = {
    project: `p-${suffix}`,
    todo: `t-${suffix}`,
    build: `b-${suffix}`,
    step: `s-${suffix}`,
  };
  insert(sqlite, 'project', { id: ids.project, name: suffix, teamId });
  insert(sqlite, 'todo', {
    id: ids.todo,
    teamId,
    projectId: ids.project,
    title: suffix,
    phaseAt: 1,
    seqNum: 1,
  });
  insert(sqlite, 'build', {
    id: ids.build,
    todoId: ids.todo,
    withPlan: 0,
    triggerSource: 'user',
    createdAt: 1,
  });
  insert(sqlite, 'step', { id: ids.step, buildId: ids.build, kind: 'review', createdAt: 1 });
  return ids;
}

const digestRow = (buildId: string, headSha: string, patchDigest: string): Row => ({
  buildId,
  headSha,
  patchDigest,
  countedFiles: 3,
  countedLines: 42,
  keptFiles: 2,
  keptLines: 40,
  createdAt: 10,
});

const roundRow = (id: string, buildId: string, patchDigest: string, round: number): Row => ({
  id,
  buildId,
  patchDigest,
  round,
  perspectives: JSON.stringify(['code', 'security', 'tests']),
  startedAt: 10,
});

const verdictRow = (stepId: string, buildId: string, over: Row = {}): Row => ({
  stepId,
  buildId,
  kind: 'review',
  perspective: 'security',
  outcome: 'pass',
  patchDigest: D1,
  headSha: H1,
  expectedHeadSha: H1,
  createdAt: 10,
  ...over,
});

const stateRow = (buildId: string, over: Row = {}): Row => ({
  buildId,
  ready: 0,
  headSha: H1,
  patchDigest: D1,
  policy: 'human',
  blockers: JSON.stringify([
    { code: 'policy-human', class: 'policy', label: '项目策略为人工合并', detail: [] },
  ]),
  evaluatedAt: 10,
  ...over,
});

/** 四张表各种一行（verdict 挂在给定步上）。 */
function seedGateRows(sqlite: Database.Database, buildId: string, stepId: string): void {
  insert(sqlite, 'gate_digest', digestRow(buildId, H1, D1));
  insert(sqlite, 'gate_round', roundRow(`r-${buildId}`, buildId, D1, 1));
  insert(sqlite, 'gate_verdict', verdictRow(stepId, buildId));
  insert(sqlite, 'gate_state', stateRow(buildId));
}

/** 内存库，开法同 db/client.ts openDbWithHandle（外键开、同一 migrations 目录），
 * 另留原生句柄给 SQL 断言。 */
function memory(): { db: Db; sqlite: Database.Database; teamId: string } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const { team } = seed(db);
  return { db, sqlite, teamId: team.id };
}

/** 经 drizzle 读本构建在四表的行数（bootServer 只给 drizzle 句柄）。 */
function gateCounts(db: Db, buildId: string): Record<(typeof GATE_TABLES)[number], number> {
  return {
    gate_digest: db
      .select()
      .from(schema.gateDigest)
      .where(eq(schema.gateDigest.buildId, buildId))
      .all().length,
    gate_round: db
      .select()
      .from(schema.gateRound)
      .where(eq(schema.gateRound.buildId, buildId))
      .all().length,
    gate_verdict: db
      .select()
      .from(schema.gateVerdict)
      .where(eq(schema.gateVerdict.buildId, buildId))
      .all().length,
    gate_state: db
      .select()
      .from(schema.gateState)
      .where(eq(schema.gateState.buildId, buildId))
      .all().length,
  };
}

// —— 迁移定位与旧库升级（F1 / F16）——————————————————————————————————————

function readJournal(folder: string): { entries: { idx: number; tag: string; when: number }[] } {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
}

const GATE_MARKER = /CREATE TABLE `gate_verdict`/;

function findGateEntry() {
  const journal = readJournal(MIGRATIONS_FOLDER);
  const index = journal.entries.findIndex((e) =>
    GATE_MARKER.test(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8')),
  );
  expect(index, 'journal 里找不到建 gate_verdict 的 migration').toBeGreaterThan(0);
  return { journal, index, entry: journal.entries[index]! };
}

describe('F1 / F16 旧库升级：main 的库补跑本迁移', () => {
  test('本迁移的 when 大于此前每一条（否则 migrator 对旧库静默跳过）', () => {
    const { journal, index, entry } = findGateEntry();
    const before = Math.max(...journal.entries.slice(0, index).map((e) => e.when));
    expect(entry.when).toBeGreaterThan(before);
  });

  test('截到本迁移之前的库（带构建行）→ 全量 migrate：四表建成、旧行不动、可为旧构建写闸行', () => {
    const { journal, index } = findGateEntry();
    const preDir = temp('pacman-migrations-pre-gate-');
    mkdirSync(join(preDir, 'meta'));
    for (const e of journal.entries.slice(0, index)) {
      writeFileSync(
        join(preDir, `${e.tag}.sql`),
        readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`)),
      );
    }
    writeFileSync(
      join(preDir, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }, null, 2),
    );

    const dbPath = join(temp('pacman-gate-upgrade-'), 'server.db');
    const old = new Database(dbPath);
    old.pragma('foreign_keys = ON');
    const oldDb = drizzle(old, { schema });
    migrate(oldDb, { migrationsFolder: preDir });
    const { team } = seed(oldDb);
    const ids = seedBuild(old, team.id, 'old');
    const tableNames = (s: Database.Database) =>
      (s.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
        .map((r) => r.name)
        .filter((n) => n.startsWith('gate_'));
    expect(tableNames(old)).toEqual([]);
    old.close();

    const upgraded = new Database(dbPath);
    upgraded.pragma('foreign_keys = ON');
    migrate(drizzle(upgraded, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    expect(tableNames(upgraded).sort()).toEqual([...GATE_TABLES].sort());
    expect(upgraded.prepare('SELECT id, todoId FROM build').all()).toEqual([
      { id: ids.build, todoId: ids.todo },
    ]);
    seedGateRows(upgraded, ids.build, ids.step);
    for (const t of GATE_TABLES) expect(count(upgraded, t, ids.build), t).toBe(1);
    upgraded.close();
  });
});

// —— gate_round（F2 / F3）——————————————————————————————————————————————

describe('gate_round：每 (buildId, patchDigest) 一轮', () => {
  test('F2 同一构建同一摘要的第二轮被 UNIQUE 拒绝；别的构建同摘要、同构建别的摘要照常', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    const b = seedBuild(sqlite, teamId, 'b');
    insert(sqlite, 'gate_round', roundRow('r1', a.build, D1, 1));
    expect(() => insert(sqlite, 'gate_round', roundRow('r2', a.build, D1, 2))).toThrow(
      /UNIQUE constraint failed: gate_round\.buildId, gate_round\.patchDigest/,
    );
    insert(sqlite, 'gate_round', roundRow('r3', b.build, D1, 1));
    insert(sqlite, 'gate_round', roundRow('r4', a.build, D2, 2));
    expect(count(sqlite, 'gate_round', a.build)).toBe(2);
    expect(count(sqlite, 'gate_round', b.build)).toBe(1);
  });

  test('F3 同一构建两轮同号被 UNIQUE 拒绝（roundsMax 按轮号数）', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_round', roundRow('r1', a.build, D1, 1));
    expect(() => insert(sqlite, 'gate_round', roundRow('r2', a.build, D2, 1))).toThrow(
      /UNIQUE constraint failed: gate_round\.buildId, gate_round\.round/,
    );
  });

  test('缺省值：fixRound 0、state open、timedOut []、dispatches {}（drizzle 读回）', () => {
    const { db, sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_round', roundRow('r1', a.build, D1, 1));
    expect(db.select().from(schema.gateRound).all()).toEqual([
      {
        id: 'r1',
        buildId: a.build,
        patchDigest: D1,
        round: 1,
        fixRound: 0,
        state: 'open',
        perspectives: ['code', 'security', 'tests'],
        timedOut: [],
        dispatches: {},
        startedAt: 10,
      },
    ]);
  });
});

// —— gate_verdict（F4 / F5 / F8 / F9）——————————————————————————————————

describe('gate_verdict：每步一条，只挂真实的步与构建', () => {
  test('F4 同一步的第二条判定被主键拒绝', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_verdict', verdictRow(a.step, a.build));
    expect(() =>
      insert(sqlite, 'gate_verdict', verdictRow(a.step, a.build, { outcome: 'block' })),
    ).toThrow(/UNIQUE constraint failed: gate_verdict\.stepId/);
    expect(sqlite.prepare('SELECT outcome FROM gate_verdict').all()).toEqual([{ outcome: 'pass' }]);
  });

  test('F5 不存在的步、不存在的构建：外键拒绝', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    expect(() => insert(sqlite, 'gate_verdict', verdictRow('no-such-step', a.build))).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() => insert(sqlite, 'gate_verdict', verdictRow(a.step, 'no-such-build'))).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  test('F8 head 对不上的判定（patchDigest null）、没报 head、没有视角：照存，读回 null', () => {
    const { db, sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(
      sqlite,
      'gate_verdict',
      verdictRow(a.step, a.build, {
        kind: 'verify',
        perspective: null,
        outcome: 'extraction_failed',
        patchDigest: null,
        headSha: null,
      }),
    );
    expect(db.select().from(schema.gateVerdict).all()).toEqual([
      {
        stepId: a.step,
        buildId: a.build,
        kind: 'verify',
        perspective: null,
        outcome: 'extraction_failed',
        patchDigest: null,
        headSha: null,
        expectedHeadSha: H1,
        createdAt: 10,
      },
    ]);
  });

  test('S2 的三种 kind 与七种 outcome 都存得下', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    const outcomes = [
      'pass',
      'block',
      'extraction_failed',
      'step_failed',
      'tampered',
      'unbound',
      'evidence_invalid',
    ];
    const kinds = ['review', 'verify', 'decision'];
    outcomes.forEach((outcome, i) => {
      const stepId = `s-o${i}`;
      insert(sqlite, 'step', { id: stepId, buildId: a.build, kind: 'review', createdAt: 1 });
      insert(sqlite, 'gate_verdict', verdictRow(stepId, a.build, { outcome, kind: kinds[i % 3]! }));
    });
    expect(
      (sqlite.prepare('SELECT outcome FROM gate_verdict ORDER BY stepId').all() as Row[]).map(
        (r) => r.outcome,
      ),
    ).toEqual(outcomes);
  });

  test('F9 chief 小合并步（step.buildId = chief 线程，无 build 行）的判定挂被审构建；删构建带走判定、不动 chief 步', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'step', { id: 's-chief', buildId: 'chief-x', kind: 'chief', createdAt: 1 });
    insert(
      sqlite,
      'gate_verdict',
      verdictRow('s-chief', a.build, { kind: 'decision', perspective: 'chief' }),
    );
    expect(count(sqlite, 'gate_verdict', a.build)).toBe(1);
    sqlite.prepare('DELETE FROM build WHERE id = ?').run(a.build);
    expect(count(sqlite, 'gate_verdict', a.build)).toBe(0);
    expect(sqlite.prepare("SELECT id FROM step WHERE id = 's-chief'").all()).toEqual([
      { id: 's-chief' },
    ]);
  });

  test('判定表按 buildId 有索引（readiness 每轮读本构建全部判定）', () => {
    const { sqlite } = memory();
    const plan = sqlite
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM gate_verdict WHERE buildId = 'x'")
      .all() as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/USING INDEX gate_verdict_buildId_idx/);
  });
});

// —— gate_state / gate_digest（F10 / F11 / F12）————————————————————————

describe('gate_state：每构建一份最新快照', () => {
  test('F10 同一构建第二份快照被主键拒绝；按 buildId upsert 覆盖成一行', () => {
    const { db, sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_state', stateRow(a.build));
    expect(() => insert(sqlite, 'gate_state', stateRow(a.build))).toThrow(
      /UNIQUE constraint failed: gate_state\.buildId/,
    );
    db.insert(schema.gateState)
      .values({
        buildId: a.build,
        ready: true,
        headSha: H2,
        patchDigest: D2,
        policy: 'autonomous',
        blockers: [],
        evaluatedAt: 20,
      })
      .onConflictDoUpdate({
        target: schema.gateState.buildId,
        set: { ready: true, headSha: H2, patchDigest: D2, blockers: [], evaluatedAt: 20 },
      })
      .run();
    expect(
      db
        .select({
          ready: schema.gateState.ready,
          headSha: schema.gateState.headSha,
          evaluatedAt: schema.gateState.evaluatedAt,
        })
        .from(schema.gateState)
        .all(),
    ).toEqual([{ ready: true, headSha: H2, evaluatedAt: 20 }]);
  });

  test('F11 blockers 往返不失真（转义名、双向控制符、中文标签、S2 名单上限），存的是合法 JSON', () => {
    const { db, sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    // S2 的 detail：名字写成 JSON 串、不可见字符写成 \uXXXX、每名至多 120 字符加 …、
    // 每份名单至多 10 个加 +N more。这里按上限造满，再混入原样的控制字符。
    const longName = `"${'名'.repeat(118)}"…`;
    const blockers = Array.from({ length: 60 }, (_, i) => ({
      code: `code-${i}`,
      class: (['policy', 'transient', 'human'] as const)[i % 3]!,
      label: '证据目录外有看不到 diff 的文件（二进制、diff 过大或纯改名）',
      detail: [
        ...Array.from({ length: 10 }, () => longName),
        '+7 more',
        '"a\\u202eb"',
        'raw \u202e bidi \u0000 nul \n newline',
      ],
    }));
    db.insert(schema.gateState)
      .values({
        buildId: a.build,
        ready: false,
        headSha: null,
        patchDigest: null,
        policy: 'shadow',
        blockers,
        evaluatedAt: 30,
      })
      .run();
    const back = db.select().from(schema.gateState).get();
    expect(back?.blockers).toEqual(blockers);
    expect(back?.headSha).toBeNull();
    expect(back?.patchDigest).toBeNull();
    expect(
      sqlite
        .prepare('SELECT json_valid(blockers) AS ok, typeof(blockers) AS t FROM gate_state')
        .get(),
    ).toEqual({ ok: 1, t: 'text' });
  });
});

describe('gate_digest：每 (buildId, headSha) 一份摘要', () => {
  test('F12 同一 head 第二份被主键拒绝；update-branch 后新 head 同摘要照常落', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_digest', digestRow(a.build, H1, D1));
    expect(() => insert(sqlite, 'gate_digest', digestRow(a.build, H1, D2))).toThrow(
      /UNIQUE constraint failed: gate_digest\.buildId, gate_digest\.headSha/,
    );
    insert(sqlite, 'gate_digest', digestRow(a.build, H2, D1));
    expect(count(sqlite, 'gate_digest', a.build)).toBe(2);
  });
});

// —— 删除（F6 / F7）——————————————————————————————————————————————————

describe('F6 删构建：本构建四表的行随之删除，别的构建不动', () => {
  test('DELETE build 级联', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    const b = seedBuild(sqlite, teamId, 'b');
    seedGateRows(sqlite, a.build, a.step);
    seedGateRows(sqlite, b.build, b.step);
    sqlite.prepare('DELETE FROM build WHERE id = ?').run(a.build);
    for (const t of GATE_TABLES) {
      expect(count(sqlite, t, a.build), t).toBe(0);
      expect(count(sqlite, t, b.build), t).toBe(1);
    }
  });
});

describe('F7 现有删除路径带着闸行照常成功', () => {
  async function started(): Promise<{
    s: TestServer;
    projectId: string;
    todoId: string;
    buildId: string;
  }> {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const todo = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'g', spec: 'x' })
      ).json(),
    );
    const [b] = startBuilds(s.svc, {
      projectId,
      todoIds: [todo.id],
      assignment: { plan: null, build: null },
      withPlan: true,
    });
    const buildId = b!.id;
    const stepRow = s.db
      .select({ id: schema.step.id })
      .from(schema.step)
      .where(eq(schema.step.buildId, buildId))
      .get();
    // drizzle 写法（S5a/S6a 落库同形），四表各一行，判定挂在这条构建的真步上。
    s.db
      .insert(schema.gateDigest)
      .values({
        buildId,
        headSha: H1,
        patchDigest: D1,
        countedFiles: 3,
        countedLines: 42,
        keptFiles: 2,
        keptLines: 40,
        createdAt: 10,
      })
      .run();
    s.db
      .insert(schema.gateRound)
      .values({
        id: 'r1',
        buildId,
        patchDigest: D1,
        round: 1,
        perspectives: ['code'],
        startedAt: 10,
      })
      .run();
    s.db
      .insert(schema.gateVerdict)
      .values({
        stepId: stepRow!.id,
        buildId,
        kind: 'review',
        perspective: 'code',
        outcome: 'pass',
        patchDigest: D1,
        headSha: H1,
        expectedHeadSha: H1,
        createdAt: 10,
      })
      .run();
    s.db
      .insert(schema.gateState)
      .values({
        buildId,
        ready: false,
        headSha: H1,
        patchDigest: D1,
        policy: 'human',
        blockers: [],
        evaluatedAt: 10,
      })
      .run();
    expect(gateCounts(s.db, buildId)).toEqual({
      gate_digest: 1,
      gate_round: 1,
      gate_verdict: 1,
      gate_state: 1,
    });
    return { s, projectId, todoId: todo.id, buildId };
  }

  function expectGone(s: TestServer, buildId: string): void {
    expect(gateCounts(s.db, buildId)).toEqual({
      gate_digest: 0,
      gate_round: 0,
      gate_verdict: 0,
      gate_state: 0,
    });
  }

  test('重置任务（先删步、再删构建）', async () => {
    const { s, todoId, buildId } = await started();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/reset`, {});
    expect(res.status).toBe(200);
    expectGone(s, buildId);
    s.dispose();
  });

  test('删除任务（todo → build 级联）', async () => {
    const { s, todoId, buildId } = await started();
    const res = await req(s.app, 'DELETE', `/api/todos/${todoId}`);
    expect(res.status).toBe(204);
    expectGone(s, buildId);
    s.dispose();
  });

  test('删除项目（事务内删步、删任务）', async () => {
    const { s, projectId, buildId } = await started();
    const res = await req(s.app, 'DELETE', `/api/projects/${projectId}`);
    expect(res.status).toBe(204);
    expectGone(s, buildId);
    s.dispose();
  });
});

// —— 登记与写入面（F14 / F15）————————————————————————————————————————————

describe('F14 共享表清单', () => {
  test('四表进 DB_TABLES 与 INTERNAL_ONLY_TABLES（无 wire record，readiness 经构建记录展示）', () => {
    for (const t of GATE_TABLES) {
      expect(DB_TABLES).toContain(t);
      expect(INTERNAL_ONLY_TABLES).toContain(t);
    }
  });
});

describe('F15 机器回传面不碰闸表', () => {
  test('routes-machine.ts 与 services/machine*.ts 不引用四张表', () => {
    const src = resolve(import.meta.dirname, '../src');
    const files = [
      join(src, 'routes-machine.ts'),
      ...readdirSync(join(src, 'services'))
        .filter((f) => /^machine.*\.ts$/.test(f))
        .map((f) => join(src, 'services', f)),
    ];
    expect(files.length).toBeGreaterThan(1);
    const ref = /\bgate_(digest|round|verdict|state)\b|\bgate(Digest|Round|Verdict|State)\b/;
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(ref);
  });
});

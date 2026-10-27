import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DB_TABLES, INTERNAL_ONLY_TABLES, todoRecordSchema } from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { type Db, MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { startBuilds } from '../src/services/builds.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

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

function seedTeam(sqlite: Database.Database): string {
  insert(sqlite, 'user', { id: 'u-1', displayName: 'Owner' });
  insert(sqlite, 'team', { id: 'team-1', name: "Owner's team", createdAt: 1 });
  return 'team-1';
}

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

function seedGateRows(sqlite: Database.Database, buildId: string, stepId: string): void {
  insert(sqlite, 'gate_digest', digestRow(buildId, H1, D1));
  insert(sqlite, 'gate_round', roundRow(`r-${buildId}`, buildId, D1, 1));
  insert(sqlite, 'gate_verdict', verdictRow(stepId, buildId));
  insert(sqlite, 'gate_state', stateRow(buildId));
}

function memory(): { db: Db; sqlite: Database.Database; teamId: string } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const { team } = seed(db);
  return { db, sqlite, teamId: team.id };
}

function gateCounts(db: Db, buildId: string): Record<string, number> {
  return Object.fromEntries(
    GATE_TABLES.map((t) => [
      t,
      db.get<{ n: number }>(
        sql`SELECT count(*) AS n FROM ${sql.identifier(t)} WHERE "buildId" = ${buildId}`,
      ).n,
    ]),
  );
}

const GATE_MARKER = /CREATE TABLE `gate_verdict`/;

type Journal = { entries: { idx: number; tag: string; when: number }[] };

function findGateEntry() {
  const journal: Journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  );
  const index = journal.entries.findIndex((e) =>
    GATE_MARKER.test(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), 'utf8')),
  );
  expect(index, 'journal 里找不到建 gate_verdict 的 migration').toBeGreaterThan(0);
  return { journal, index, entry: journal.entries[index]! };
}

function migrationsUpTo(
  journal: Journal,
  end: number,
  extra?: { tag: string; sql: string },
): string {
  const dir = temp('cairn-migrations-');
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.slice(0, end);
  for (const e of entries) {
    writeFileSync(join(dir, `${e.tag}.sql`), readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`)));
  }
  if (extra) {
    const when = Math.max(...journal.entries.map((e) => e.when)) + 1;
    entries.push({ idx: entries.length, tag: extra.tag, when });
    writeFileSync(join(dir, `${extra.tag}.sql`), extra.sql);
  }
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

describe('F1 / F16 legacy db upgrade: a db from main catches up on this migration', () => {
  test('this migration when is greater than every earlier one (otherwise the migrator silently skips it for legacy dbs)', () => {
    const { journal, index, entry } = findGateEntry();
    const before = Math.max(...journal.entries.slice(0, index).map((e) => e.when));
    expect(entry.when).toBeGreaterThan(before);
  });

  test('a db cut before this migration (with build rows) -> full migrate: the four tables created, old rows untouched, gate rows writable for old builds', () => {
    const { journal, index } = findGateEntry();
    const dbPath = join(temp('cairn-gate-upgrade-'), 'server.db');
    const old = new Database(dbPath);
    old.pragma('foreign_keys = ON');
    migrate(drizzle(old), { migrationsFolder: migrationsUpTo(journal, index) });
    const ids = seedBuild(old, seedTeam(old), 'old');
    const tableNames = (s: Database.Database) =>
      (s.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
        .map((r) => r.name)
        .filter((n) => n.startsWith('gate_'));
    expect(tableNames(old)).toEqual([]);
    old.close();

    const upgraded = new Database(dbPath);
    upgraded.pragma('foreign_keys = ON');
    migrate(drizzle(upgraded), { migrationsFolder: MIGRATIONS_FOLDER });
    expect(tableNames(upgraded).sort()).toEqual([...GATE_TABLES].sort());
    expect(upgraded.prepare('SELECT id, todoId FROM build').all()).toEqual([
      { id: ids.build, todoId: ids.todo },
    ]);
    seedGateRows(upgraded, ids.build, ids.step);
    for (const t of GATE_TABLES) expect(count(upgraded, t, ids.build), t).toBe(1);
    upgraded.close();
  });
});

describe('gate_round: one round per (buildId, patchDigest)', () => {
  test('F2 a second round for the same build and digest is rejected by UNIQUE; another build with the same digest, or the same build with another digest, still works', () => {
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

  test('F3 two rounds of one build with the same number rejected by UNIQUE (roundsMax counts rounds by number)', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_round', roundRow('r1', a.build, D1, 1));
    expect(() => insert(sqlite, 'gate_round', roundRow('r2', a.build, D2, 1))).toThrow(
      /UNIQUE constraint failed: gate_round\.buildId, gate_round\.round/,
    );
  });

  test('F21 a round without patchDigest rejected by NOT NULL (UNIQUE treats NULLs as distinct, an empty digest could open endless rounds)', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    expect(() =>
      insert(sqlite, 'gate_round', { ...roundRow('r1', a.build, D1, 1), patchDigest: null }),
    ).toThrow(/NOT NULL constraint failed: gate_round\.patchDigest/);
    expect(count(sqlite, 'gate_round', a.build)).toBe(0);
  });

  test('defaults: fixRound 0, state open, timedOut [], dispatches {} (read back through drizzle)', () => {
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

describe('gate_verdict: one row per step, attached only to real builds', () => {
  test('F4 a second verdict for the same step is rejected by the primary key', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_verdict', verdictRow(a.step, a.build));
    expect(() =>
      insert(sqlite, 'gate_verdict', verdictRow(a.step, a.build, { outcome: 'block' })),
    ).toThrow(/UNIQUE constraint failed: gate_verdict\.stepId/);
    expect(sqlite.prepare('SELECT outcome FROM gate_verdict').all()).toEqual([{ outcome: 'pass' }]);
  });

  test('F5 a nonexistent build: rejected by the foreign key; stepId has no foreign key (F17/F18), supplied by the server writer that queues the step', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    expect(() => insert(sqlite, 'gate_verdict', verdictRow(a.step, 'no-such-build'))).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    insert(sqlite, 'gate_verdict', verdictRow('no-such-step', a.build));
    expect(count(sqlite, 'gate_verdict', a.build)).toBe(1);
  });

  test('F20 a verdict without expectedHeadSha rejected by NOT NULL (verdicts bind only to the head the server pinned when queueing the step)', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    expect(() =>
      insert(sqlite, 'gate_verdict', verdictRow(a.step, a.build, { expectedHeadSha: null })),
    ).toThrow(/NOT NULL constraint failed: gate_verdict\.expectedHeadSha/);
    expect(count(sqlite, 'gate_verdict', a.build)).toBe(0);
  });

  test('F8 a verdict whose head does not match (patchDigest null), no head reported, no perspective: stored as is, read back null', () => {
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

  test('all three kinds and seven outcomes of S2 are storable', () => {
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

  test('F9 a verdict of a chief mini-merge step (step.buildId = the chief thread, no build row) attaches to the reviewed build; deleting the build takes the verdict, the chief step stays', () => {
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

  test('the verdict table has an index on buildId (readiness reads all verdicts of the build each round)', () => {
    const { sqlite } = memory();
    const plan = sqlite
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM gate_verdict WHERE buildId = 'x'")
      .all() as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/USING INDEX gate_verdict_buildId_idx/);
  });
});

describe('gate_state: one latest snapshot per build', () => {
  test('F10 a second snapshot of the same build is rejected by the primary key; an upsert by buildId overwrites into one row', () => {
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

  test('F11 blockers round-trip without loss (escaped names, bidi controls, CJK labels, the S2 list cap), stored as valid JSON', () => {
    const { db, sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
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

describe('gate_digest: one digest per (buildId, headSha)', () => {
  test('F12 a second entry for the same head rejected by the primary key; after update-branch the same digest on the new head lands as usual', () => {
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

describe('F6 deleting a build: rows of this build in the four tables go with it, other builds untouched', () => {
  test('DELETE build cascades', () => {
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

describe('F7 the existing delete paths succeed with gate rows present', () => {
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

  test('resetting a todo (steps deleted first, then builds)', async () => {
    const { s, todoId, buildId } = await started();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/reset`, {});
    expect(res.status).toBe(200);
    expectGone(s, buildId);
    s.dispose();
  });

  test('deleting a todo (todo -> build cascade)', async () => {
    const { s, todoId, buildId } = await started();
    const res = await req(s.app, 'DELETE', `/api/todos/${todoId}`);
    expect(res.status).toBe(204);
    expectGone(s, buildId);
    s.dispose();
  });

  test('deleting a project (steps and todos deleted in the transaction)', async () => {
    const { s, projectId, buildId } = await started();
    const res = await req(s.app, 'DELETE', `/api/projects/${projectId}`);
    expect(res.status).toBe(204);
    expectGone(s, buildId);
    s.dispose();
  });
});

describe('F17 / F18 / F19 gate rows are deleted only with the build', () => {
  test('F17 the follow-up migration rebuilds step in the drizzle shape (__new_step, copy rows, DROP TABLE step, rename): not one verdict or step missing', () => {
    const { db, sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    const b = seedBuild(sqlite, teamId, 'b');
    seedGateRows(sqlite, a.build, a.step);
    insert(
      sqlite,
      'gate_verdict',
      verdictRow(b.step, b.build, { kind: 'verify', perspective: null, outcome: 'tampered' }),
    );
    insert(sqlite, 'step', { id: 's-chief', buildId: 'chief-x', kind: 'chief', createdAt: 1 });
    insert(
      sqlite,
      'gate_verdict',
      verdictRow('s-chief', a.build, { kind: 'decision', perspective: 'chief' }),
    );
    const rows = (table: string) => sqlite.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();
    const verdicts = () => sqlite.prepare('SELECT * FROM gate_verdict ORDER BY stepId').all();
    const stepsBefore = rows('step');
    const verdictsBefore = verdicts();
    expect(verdictsBefore).toHaveLength(3);

    const { sql: createStep } = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'step'")
      .get() as { sql: string };
    const cols = (sqlite.prepare('PRAGMA table_info(step)').all() as { name: string }[])
      .map((c) => `"${c.name}"`)
      .join(', ');
    const recreate = [
      'PRAGMA foreign_keys=OFF;',
      `${createStep.replace(/^CREATE TABLE [`"]?step[`"]?/, 'CREATE TABLE `__new_step`')};`,
      `INSERT INTO \`__new_step\`(${cols}) SELECT ${cols} FROM \`step\`;`,
      'DROP TABLE `step`;',
      'ALTER TABLE `__new_step` RENAME TO `step`;',
      'PRAGMA foreign_keys=ON;',
    ].join('--> statement-breakpoint\n');
    const { journal } = findGateEntry();
    migrate(db, {
      migrationsFolder: migrationsUpTo(journal, journal.entries.length, {
        tag: '9999_recreate_step',
        sql: recreate,
      }),
    });

    expect(
      sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get(),
      '合成迁移确实跑了',
    ).toEqual({ n: journal.entries.length + 1 });
    expect(rows('step')).toEqual(stepsBefore);
    expect(verdicts()).toEqual(verdictsBefore);
  });

  test('F18 deleting a step (the build remains): the verdicts stay; only deleting the build takes them', () => {
    const { sqlite, teamId } = memory();
    const a = seedBuild(sqlite, teamId, 'a');
    insert(sqlite, 'gate_verdict', verdictRow(a.step, a.build, { outcome: 'block' }));
    sqlite.prepare('DELETE FROM step WHERE id = ?').run(a.step);
    expect(sqlite.prepare('SELECT stepId, outcome FROM gate_verdict').all()).toEqual([
      { stepId: a.step, outcome: 'block' },
    ]);
    sqlite.prepare('DELETE FROM build WHERE id = ?').run(a.build);
    expect(count(sqlite, 'gate_verdict', a.build)).toBe(0);
  });

  test('F19 a db cut at this migration (rows in all four tables) -> every later migration runs: not one row of the four tables missing', () => {
    const { journal, index } = findGateEntry();
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsUpTo(journal, index + 1) });
    const a = seedBuild(sqlite, seedTeam(sqlite), 'a');
    seedGateRows(sqlite, a.build, a.step);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(
      sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get(),
      '之后的迁移全部跑了',
    ).toEqual({ n: journal.entries.length });
    for (const t of GATE_TABLES) expect(count(sqlite, t, a.build), t).toBe(1);
  });
});

describe('F14 shared table list', () => {
  test('the four tables are in DB_TABLES and INTERNAL_ONLY_TABLES (no wire record, readiness surfaces them via build records)', () => {
    for (const t of GATE_TABLES) {
      expect(DB_TABLES).toContain(t);
      expect(INTERNAL_ONLY_TABLES).toContain(t);
    }
  });
});

describe('F15 the machine report surface never touches the gate tables', () => {
  test('machine report modules cannot directly access gate tables or transitively import the server gate adapter', () => {
    const src = resolve(import.meta.dirname, '../src');
    const files = [
      join(src, 'routes-machine.ts'),
      ...readdirSync(join(src, 'services'))
        .filter((f) => /^machine.*\.ts$/.test(f) && f !== 'machine-gate-port.ts')
        .map((f) => join(src, 'services', f)),
    ];
    expect(files.length).toBeGreaterThan(1);
    const ref = /\bgate_(digest|round|verdict|state)\b|\bgate(Digest|Round|Verdict|State)\b/;
    const adapter = join(src, 'services/machine-gate-port.ts');
    const visit = (file: string, seen: Set<string>): void => {
      expect(file).not.toBe(adapter);
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      const imports = source.matchAll(
        /\b(?:import|export)\s+(?!type\b)(?:(?!\b(?:import|export)\b)[\s\S])*?\bfrom\s*['"]([^'"]+)['"]/g,
      );
      const sideEffects = source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g);
      for (const match of [...imports, ...sideEffects]) {
        const specifier = match[1];
        if (specifier === undefined || !specifier.startsWith('.')) continue;
        const dependency = resolve(dirname(file), specifier).replace(/\.js$/, '.ts');
        visit(dependency, seen);
      }
    };
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(ref);
      visit(f, new Set());
    }
  });
});

test('a real machine completion cannot forge internal gate records', async () => {
  const s = bootServer();
  try {
    const key = await issueApiKey(s);
    const enrolled = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: s.team.id,
        name: 'untrusted-gate-reporter',
        cliVersion: '0.1.0',
      }),
    });
    expect(enrolled.status).toBe(200);
    const { token, machineId } = (await enrolled.json()) as { token: string; machineId: string };
    const projectId = await postProject(s.app);
    s.db
      .insert(schema.todo)
      .values({
        id: 'report-todo',
        teamId: s.team.id,
        projectId,
        title: 'report',
        phase: 'building',
        phaseAt: 1,
        seqNum: 1,
        latestBuildId: 'report-build',
      })
      .run();
    s.db
      .insert(schema.build)
      .values({
        id: 'report-build',
        todoId: 'report-todo',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(schema.step)
      .values({
        id: 'report-step',
        buildId: 'report-build',
        kind: 'build',
        status: 'claimed',
        machineId,
        createdAt: 1,
      })
      .run();
    const response = await s.app.request('/api/machine/done/report-step', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'success',
        hasChanges: true,
        commit: H1,
        usage: [{ model: 'reported-model', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }],
        gateState: { ...stateRow('report-build'), ready: true, blockers: [] },
        gateDigest: digestRow('report-build', H1, D1),
        gateRound: {
          ...roundRow('forged-round', 'report-build', D1, 1),
          perspectives: ['security'],
        },
        gateVerdict: verdictRow('report-step', 'report-build', { kind: 'decision' }),
      }),
    });
    expect(response.status).toBe(200);
    expect(
      s.db.select().from(schema.step).where(eq(schema.step.id, 'report-step')).get(),
    ).toMatchObject({ status: 'done' });
    expect(gateCounts(s.db, 'report-build')).toEqual({
      gate_digest: 0,
      gate_round: 0,
      gate_verdict: 0,
      gate_state: 0,
    });
  } finally {
    s.dispose();
  }
});

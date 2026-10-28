import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import {
  buildOutcomeBackfill,
  build as buildTable,
  message as messageTable,
  project as projectTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { DONE_ROW } from '../src/services/delivery-rows.js';
import { derivePackOutcome } from '../src/trajectory-outcome.js';
import { sweepOutcomeBackfill } from '../src/trajectory-outcome-backfill.js';
import { bootServer } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'backfill-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'backfill-probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};

const dirs: string[] = [];
const servers: { dispose(): void }[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.dispose();
});

function git(args: string[], cwd: string, dateMs?: number) {
  const env = { ...GIT_ENV };
  if (dateMs !== undefined) {
    const iso = new Date(dateMs).toISOString();
    env.GIT_AUTHOR_DATE = iso;
    env.GIT_COMMITTER_DATE = iso;
  }
  return runGit(args, { cwd, env, timeoutMs: 60_000 });
}

async function gitOk(args: string[], cwd: string, dateMs?: number) {
  const result = await git(args, cwd, dateMs);
  expect(result.code, `${args.join(' ')}: ${result.stderr}`).toBe(0);
  return result;
}

const BASE_CONTENT = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n');

interface RepoFixture {
  dir: string;
  t0: number;
}

async function makeRepo(): Promise<RepoFixture> {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-backfill-repo-'));
  dirs.push(dir);
  await gitOk(['init', '-b', 'main'], dir);
  await gitOk(['config', 'user.name', 'probe'], dir);
  await gitOk(['config', 'user.email', 'probe@localhost'], dir);
  const t0 = Date.now() - 40 * DAY;
  writeFileSync(join(dir, 'app.txt'), `${BASE_CONTENT}\n`);
  await gitOk(['add', 'app.txt'], dir);
  await gitOk(['commit', '-m', 'chore: base'], dir, t0);
  return { dir, t0 };
}

async function mergePr(
  dir: string,
  prNumber: number,
  lineBefore: string,
  lineAfter: string,
  dateMs: number,
) {
  await gitOk(['checkout', '-B', `pr-${prNumber}`], dir);
  const content = (await git(['show', 'main:app.txt'], dir)).stdout.toString();
  writeFileSync(join(dir, 'app.txt'), content.replace(lineBefore, lineAfter));
  await gitOk(['add', 'app.txt'], dir);
  await gitOk(['commit', '-m', `change ${lineBefore}`], dir, dateMs - 60_000);
  await gitOk(['checkout', 'main'], dir);
  await gitOk(['merge', '--squash', `pr-${prNumber}`], dir);
  await gitOk(
    ['commit', '-m', `feat(${prNumber}): change ${lineBefore} (#${prNumber})`],
    dir,
    dateMs,
  );
}

async function revertCommit(dir: string, subject: string, dateMs: number) {
  const log = await gitOk(['log', '--format=%s'], dir);
  const target = log.stdout
    .toString()
    .split('\n')
    .find((line) => line.includes(subject));
  expect(target).toBeTruthy();
  await gitOk(['revert', '--no-commit', 'HEAD'], dir);
  await gitOk(['commit', '-m', `Revert "${target}"`], dir, dateMs);
}

async function seedWorld(
  repoDir: string,
  merges: { pr: number; buildId: string; todoId: string; doneAt: number }[],
) {
  const s = bootServer();
  servers.push(s);
  s.db
    .insert(projectTable)
    .values({
      id: 'proj-backfill',
      teamId: s.team.id,
      name: 'backfill',
      repoKind: 'local',
      localPath: repoDir,
    })
    .run();
  for (const merge of merges) {
    s.db
      .insert(todoTable)
      .values({
        id: merge.todoId,
        teamId: s.team.id,
        projectId: 'proj-backfill',
        title: merge.todoId,
        spec: `Spec ${merge.todoId}`,
        phaseAt: 1,
        seqNum: merge.pr,
        assignment: { plan: null, build: null },
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: merge.buildId,
        todoId: merge.todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: merge.doneAt - 1000,
        baseSha: 'base-sha',
        harnessHash: 'harness-hash',
        prNumber: merge.pr,
      })
      .run();
    s.db
      .insert(messageTable)
      .values({
        id: `${merge.buildId}-done`,
        conversationId: merge.buildId,
        role: 'system',
        content: DONE_ROW,
        createdAt: merge.doneAt,
      })
      .run();
  }
  return s;
}

function silenceLogger() {
  return { info: () => {} };
}

function backfilledRow(db: ReturnType<typeof bootServer>['db'], buildId: string) {
  return db
    .select()
    .from(buildOutcomeBackfill)
    .where(eq(buildOutcomeBackfill.buildId, buildId))
    .get();
}

test('createScheduler in index.ts wires trajectoryOutcomeRunOf before trajectoryExportRunOf', () => {
  const src = readFileSync(join(import.meta.dirname, '../src/index.ts'), 'utf8');
  const call = /createScheduler\(([\s\S]*?)\n\);/.exec(src)?.[1] ?? '';
  expect(call).toMatch(/trajectoryOutcomeRunOf\(config,[\s\S]*trajectoryExportRunOf\(config,/);
});

test('a revert commit on main within 7 days backfills revertedWithin7d', async () => {
  const { dir, t0 } = await makeRepo();
  const merge42 = t0 + DAY;
  await mergePr(dir, 42, 'two', 'two v2', merge42);
  await revertCommit(dir, '(#42)', merge42 + 2 * DAY);
  const s = await seedWorld(dir, [
    { pr: 42, buildId: 'build-42', todoId: 'todo-42', doneAt: merge42 },
  ]);
  const summary = await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge42 + 10 * DAY,
  );
  expect(summary).toMatchObject({ backfilled: 1, skippedNoMerge: 0 });
  const row = await backfilledRow(s.db, 'build-42');
  expect(row).toMatchObject({ revertedWithin7d: true, fixedByLaterPr: false });
  const signals = derivePackOutcome(
    s.db,
    { id: 'build-42', todoId: 'todo-42', prNumber: 42 },
    merge42 + 10 * DAY,
  );
  expect(signals).toMatchObject({ merged: true, revertedWithin7d: true, fixedByLaterPr: false });
});

test('a later PR touching the same lines backfills fixedByLaterPr', async () => {
  const { dir, t0 } = await makeRepo();
  const merge43 = t0 + DAY;
  await mergePr(dir, 43, 'four', 'four v2', merge43);
  await mergePr(dir, 77, 'four v2', 'four v3', merge43 + 2 * DAY);
  const s = await seedWorld(dir, [
    { pr: 43, buildId: 'build-43', todoId: 'todo-43', doneAt: merge43 },
  ]);
  await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge43 + 10 * DAY,
  );
  const row = await backfilledRow(s.db, 'build-43');
  expect(row).toMatchObject({ revertedWithin7d: false, fixedByLaterPr: true });
  const signals = derivePackOutcome(
    s.db,
    { id: 'build-43', todoId: 'todo-43', prNumber: 43 },
    merge43 + 10 * DAY,
  );
  expect(signals.fixedByLaterPr).toBe(true);
});

test('a clean merge backfills both labels false', async () => {
  const { dir, t0 } = await makeRepo();
  const merge44 = t0 + DAY;
  await mergePr(dir, 44, 'six', 'six v2', merge44);
  const s = await seedWorld(dir, [
    { pr: 44, buildId: 'build-44', todoId: 'todo-44', doneAt: merge44 },
  ]);
  await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge44 + 10 * DAY,
  );
  const row = await backfilledRow(s.db, 'build-44');
  expect(row).toMatchObject({ revertedWithin7d: false, fixedByLaterPr: false });
});

test('a revert landing after the 7 day window does not set revertedWithin7d', async () => {
  const { dir, t0 } = await makeRepo();
  const merge45 = t0 + DAY;
  await mergePr(dir, 45, 'two', 'two v2', merge45);
  await revertCommit(dir, '(#45)', merge45 + 9 * DAY);
  const s = await seedWorld(dir, [
    { pr: 45, buildId: 'build-45', todoId: 'todo-45', doneAt: merge45 },
  ]);
  await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge45 + 20 * DAY,
  );
  const row = await backfilledRow(s.db, 'build-45');
  expect(row).toMatchObject({ revertedWithin7d: false });
});

test('builds still inside the 7 day window are not backfilled yet', async () => {
  const { dir, t0 } = await makeRepo();
  const merge46 = t0 + DAY;
  await mergePr(dir, 46, 'two', 'two v2', merge46);
  await revertCommit(dir, '(#46)', merge46 + DAY);
  const s = await seedWorld(dir, [
    { pr: 46, buildId: 'build-46', todoId: 'todo-46', doneAt: merge46 },
  ]);
  const summary = await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge46 + 3 * DAY,
  );
  expect(summary.backfilled).toBe(0);
  expect(await backfilledRow(s.db, 'build-46')).toBeUndefined();
});

test('empty data and unmatched PR numbers are skipped without failing', async () => {
  const { dir, t0 } = await makeRepo();
  const merge47 = t0 + DAY;
  await mergePr(dir, 47, 'two', 'two v2', merge47);
  const s = await seedWorld(dir, [
    { pr: 47, buildId: 'build-47', todoId: 'todo-47', doneAt: merge47 },
    { pr: 999, buildId: 'build-999', todoId: 'todo-999', doneAt: merge47 },
  ]);
  const empty = await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge47 - 2 * DAY,
  );
  expect(empty.backfilled).toBe(0);
  const summary = await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge47 + 10 * DAY,
  );
  expect(summary.backfilled).toBe(1);
  expect(summary.skippedNoMerge).toBe(1);
  expect(await backfilledRow(s.db, 'build-999')).toBeUndefined();
});

test('a project without a readable repo counts as skippedNoRepo', async () => {
  const { dir, t0 } = await makeRepo();
  const merge48 = t0 + DAY;
  await mergePr(dir, 48, 'two', 'two v2', merge48);
  const s = await seedWorld(dir, [
    { pr: 48, buildId: 'build-48', todoId: 'todo-48', doneAt: merge48 },
  ]);
  s.db
    .update(projectTable)
    .set({ repoKind: 'hosted', repoName: 'missing-repo', localPath: null })
    .where(eq(projectTable.id, 'proj-backfill'))
    .run();
  const summary = await sweepOutcomeBackfill(
    { db: s.db, reposDir: s.reposDir, logger: silenceLogger() },
    merge48 + 10 * DAY,
  );
  expect(summary).toMatchObject({ backfilled: 0, skippedNoRepo: 1 });
});

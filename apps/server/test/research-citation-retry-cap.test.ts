import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import * as dbClient from '../src/db/client.js';
import { build, todo, tokenUsage } from '../src/db/schema.js';
import { storeInfoReport } from '../src/services/info-handoff.js';
import { failureNeedsHuman, sweepFailedRetries } from '../src/services/needs-you.js';
import {
  CITATION_MAX_ATTEMPTS,
  checkedResearchReport,
  openCitationCheck,
  planResearchCitationChecks,
} from '../src/services/research-citations.js';
import { openResearchThread } from '../src/services/research-thread.js';
import { bootServer, insertMachine, postProject, seedRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

const url = 'https://example.com/releases/v2';
const claim = 'Version 2 adds cursor paging.';
const source = `${claim} ${url} (fetched 2026-11-04)`;
const deadModel =
  'POST /v1/messages -> 404 {"error":{"code":"model_not_found","message":"model not found"}}';
const transient = 'connection reset by peer';

async function world() {
  const s = bootServer();
  insertMachine(s);
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'citations');
  seedRoute(s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
  seedRoute(s, 'citation_check', { provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
  const opened = openResearchThread(s.svc, {
    teamId: s.team.id,
    projectId,
    tier: 2,
    title: 'Paging',
    question: 'What changed?',
    source: { kind: 'research-intake', ref: 'probe' },
  });
  land(s, opened.buildId, source, 'claude-sonnet-5-5');
  return { s, opened };
}

function land(s: TestServer, buildId: string, report: string, model: string) {
  storeInfoReport(
    { db: s.db, attachmentsDir: s.attachmentsDir },
    { buildId, teamId: s.team.id, createdBy: s.user.id, report },
  );
  s.db
    .insert(tokenUsage)
    .values({ buildId, model, input: 1, output: 1 })
    .onConflictDoNothing()
    .run();
}

function receipt() {
  const claims = [
    {
      url,
      claim,
      verdict: 'supported',
      reason: 'The release notes describe cursor support.',
      quote: 'Cursor pagination is now supported.',
      fetchedAt: '2026-11-04',
      quality: 'primary',
    },
  ];
  return `Citation audit\n\n\`\`\`json\n${JSON.stringify({ claims })}\n\`\`\``;
}

function fail(s: TestServer, check: { todoId: string; buildId: string }, error: string) {
  s.db.update(build).set({ errorMessage: error }).where(eq(build.id, check.buildId)).run();
  s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, check.todoId)).run();
}

function checkerBuildCount(s: TestServer, todoId: string) {
  return s.db.select().from(build).where(eq(build.todoId, todoId)).all().length;
}

describe('citation checker retry cap', () => {
  test('parks after one attempt when the checker model is gone', async () => {
    const { s, opened } = await world();
    const first = openCitationCheck(s.svc, opened.buildId)!;
    fail(s, first, deadModel);
    expect(openCitationCheck(s.svc, opened.buildId)?.buildId).toBe(first.buildId);
    planResearchCitationChecks(s.svc);
    expect(checkerBuildCount(s, first.todoId)).toBe(1);
    const row = s.db.select().from(build).where(eq(build.id, first.buildId)).get();
    expect(row?.errorMessage).toContain('Citation check parked');
    expect(failureNeedsHuman(row?.errorMessage ?? '')).toBe(true);
  });

  test('retries a transient failure up to the cap, then parks and starts no more builds', async () => {
    const { s, opened } = await world();
    let latest = openCitationCheck(s.svc, opened.buildId)!;
    for (let i = 1; i < CITATION_MAX_ATTEMPTS; i++) {
      fail(s, latest, transient);
      const next = openCitationCheck(s.svc, opened.buildId)!;
      expect(next.buildId).not.toBe(latest.buildId);
      latest = next;
    }
    fail(s, latest, transient);
    expect(openCitationCheck(s.svc, opened.buildId)?.buildId).toBe(latest.buildId);
    planResearchCitationChecks(s.svc);
    expect(openCitationCheck(s.svc, opened.buildId)?.buildId).toBe(latest.buildId);
    expect(checkerBuildCount(s, latest.todoId)).toBe(CITATION_MAX_ATTEMPTS);
  });

  test('the scheduler tick sequence runs a dead-model checker once, then parks', async () => {
    const { s, opened } = await world();
    const first = openCitationCheck(s.svc, opened.buildId)!;
    fail(s, first, deadModel);
    planResearchCitationChecks(s.svc);
    await sweepFailedRetries(s.svc);
    planResearchCitationChecks(s.svc);
    await sweepFailedRetries(s.svc);
    expect(checkerBuildCount(s, first.todoId)).toBe(1);
  });

  test('the scheduler tick sequence never exceeds the cap on transient failures', async () => {
    const { s, opened } = await world();
    let latest = openCitationCheck(s.svc, opened.buildId)!;
    for (let i = 0; i < CITATION_MAX_ATTEMPTS + 2; i++) {
      fail(s, latest, transient);
      await sweepFailedRetries(s.svc);
      const row = s.db.select().from(todo).where(eq(todo.id, latest.todoId)).get()!;
      if (row.latestBuildId !== latest.buildId) {
        latest = { todoId: latest.todoId, buildId: row.latestBuildId! };
        continue;
      }
      const next = openCitationCheck(s.svc, opened.buildId)!;
      latest = { todoId: next.todoId, buildId: next.buildId };
    }
    expect(checkerBuildCount(s, latest.todoId)).toBeLessThanOrEqual(CITATION_MAX_ATTEMPTS);
  });

  test('a successful check still completes within the cap', async () => {
    const { s, opened } = await world();
    const first = openCitationCheck(s.svc, opened.buildId)!;
    fail(s, first, transient);
    const second = openCitationCheck(s.svc, opened.buildId)!;
    land(s, second.buildId, receipt(), 'gpt-6.1-sol');
    s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, second.todoId)).run();
    expect(checkedResearchReport(s.db, opened.buildId)?.checkerBuildId).toBe(second.buildId);
    expect(openCitationCheck(s.svc, opened.buildId)?.buildId).toBe(second.buildId);
  });

  test('the cap survives a database restart', async () => {
    const dir = makeTestTempDir('citation-cap-restart-');
    const path = join(dir, 'server.db');
    const firstDb = dbClient.openDbWithHandle(path);
    let closeDb = () => firstDb.close();
    disposables.push(() => {
      closeDb();
      releaseTestTempDir(dir);
    });
    const mock = vi.spyOn(dbClient, 'openMemoryDb').mockReturnValue(firstDb.db);
    let fixture: Awaited<ReturnType<typeof world>>;
    try {
      fixture = await world();
    } finally {
      mock.mockRestore();
    }
    const { s, opened } = fixture;
    let latest = openCitationCheck(s.svc, opened.buildId)!;
    for (let i = 1; i < CITATION_MAX_ATTEMPTS; i++) {
      fail(s, latest, transient);
      latest = openCitationCheck(s.svc, opened.buildId)!;
    }
    fail(s, latest, transient);
    firstDb.close();
    const reopened = dbClient.openDbWithHandle(path);
    closeDb = () => reopened.close();
    const deps = { ...s.svc, db: reopened.db };
    planResearchCitationChecks(deps);
    openCitationCheck(deps, opened.buildId);
    expect(
      reopened.db.select().from(build).where(eq(build.todoId, latest.todoId)).all(),
    ).toHaveLength(CITATION_MAX_ATTEMPTS);
  });
});

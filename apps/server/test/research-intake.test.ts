import type { ChiefReportContent } from '@cairn/shared';
import {
  CHIEF_REPORT_INTAKE_MAX,
  CHIEF_REPORT_ROW_ID_PREFIX,
  chiefReportContentSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import {
  build,
  chiefMessage,
  chiefReport,
  chief as chiefTable,
  chiefThread,
  message,
  retroProposal,
  routingRule,
  step,
  todo,
  tokenUsage,
  user,
} from '../src/db/schema.js';
import { planChiefDigests } from '../src/services/chief-digest.js';
import { decideRetroProposal } from '../src/services/chief-report.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { storeInfoReport } from '../src/services/info-handoff.js';
import { intakeTally, normalizeIntakeUrl, parseIntakeItems } from '../src/services/intake-items.js';
import { openCitationCheck } from '../src/services/research-citations.js';
import { planResearchIntake } from '../src/services/research-intake.js';
import { createScheduler } from '../src/services/scheduler.js';
import { flushSelfIssueWrites } from '../src/services/todos.js';
import { bootServer, insertMachine, postProject, req, seedRoute } from './helpers.js';

const TZ = 'Asia/Shanghai';
const DAY_MS = 86_400_000;
const D1_0530 = Date.parse('2026-10-27T05:30:00+08:00');
const D1_0630 = Date.parse('2026-10-27T06:30:00+08:00');
const D1_0830 = Date.parse('2026-10-27T08:30:00+08:00');
const D1_2300 = Date.parse('2026-10-27T23:00:00+08:00');
const D2_0630 = D1_0630 + DAY_MS;
const D2_0830 = D1_0830 + DAY_MS;

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

async function world(opts: { github?: { calls: string[] } } = {}) {
  const calls = opts.github?.calls;
  const s = bootServer(
    calls === undefined
      ? {}
      : {
          githubFetch: async (input, init) => {
            calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
            return {
              ok: false,
              status: 404,
              headers: { get: () => null },
              json: async () => ({}),
              text: async () => '',
            };
          },
        },
  );
  insertMachine(s);
  disposables.push(() => s.dispose());
  if (calls !== undefined)
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'ghp_intake_token', scope: 'repo' },
    );
  const projectId =
    calls === undefined ? await postProject(s.app, 'cairn') : await postGithubProject(s.app);
  const teamId = s.team.id;
  seedRoute(s, 'session', { provider: 'claude-code', modelId: 'claude-opus-5-5' });
  seedRoute(s, 'citation_check', { provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'm' });
  s.db
    .insert(chiefTable)
    .values({
      id: 'chief-1',
      userId: s.user.id,
      teamId,
      tz: TZ,
      createdAt: 1,
    })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: 'thread-main',
      chiefId: 'chief-1',
      userId: s.user.id,
      teamId,
      title: 'main',
      sessionId: 'sess-main',
      sessionOpenedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return { s, projectId, teamId };
}

async function postGithubProject(app: Hono): Promise<string> {
  const res = await req(app, 'POST', '/api/projects', {
    name: 'cairn',
    kind: 'github',
    githubRepo: 'octo/cairn',
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

function addCoordinator(w: World, n: number) {
  const userId = `user-${n}`;
  w.s.db
    .insert(user)
    .values({ id: userId, displayName: `user ${n}` })
    .run();
  w.s.db
    .insert(chiefTable)
    .values({
      id: `chief-${n}`,
      userId,
      teamId: w.teamId,
      tz: TZ,
      createdAt: 1,
    })
    .run();
  w.s.db
    .insert(chiefThread)
    .values({
      id: `thread-${n}`,
      chiefId: `chief-${n}`,
      userId,
      teamId: w.teamId,
      title: 'main',
      sessionId: `sess-${n}`,
      sessionOpenedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return { ...w.s.svc, user: { ...w.s.user, id: userId } };
}

type World = Awaited<ReturnType<typeof world>>;

function intakeTodos(w: World) {
  return w.s.db.select().from(todo).where(eq(todo.sourceKind, 'research-intake')).all();
}

function openThread(w: World, seq: number, title: string, phase: 'todo' | 'done' | 'closed') {
  w.s.db
    .insert(todo)
    .values({
      id: `todo-${seq}`,
      teamId: w.teamId,
      projectId: w.projectId,
      title,
      phase,
      phaseAt: seq,
      seqNum: 100 + seq,
    })
    .run();
}

function land(w: World, todoId: string, report: string, audited = true): void {
  const buildId = w.s.db.select().from(todo).where(eq(todo.id, todoId)).get()?.latestBuildId;
  if (!buildId) throw new Error('intake todo has no build');
  storeInfoReport(
    { db: w.s.db, attachmentsDir: w.s.attachmentsDir },
    {
      buildId,
      teamId: w.teamId,
      createdBy: w.s.user.id,
      report,
    },
  );
  w.s.db
    .insert(tokenUsage)
    .values({ buildId, model: 'claude-opus-5-5', input: 1, output: 1 })
    .onConflictDoNothing()
    .run();
  if (audited) auditIntake(w, buildId, report);
}

function auditIntake(w: World, buildId: string, report: string): void {
  const checker = openCitationCheck(w.s.svc, buildId);
  if (!checker) return;
  let items: unknown = [];
  try {
    const raw = [...report.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].at(-1)?.[1];
    items = raw ? JSON.parse(raw) : [];
  } catch {
    items = [];
  }
  const claims = (Array.isArray(items) ? items : []).flatMap((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.url !== 'string' ||
      !/^https?:/.test(item.url)
    )
      return [];
    const claim = typeof item.claim === 'string' ? item.claim.trim() : '';
    return [
      {
        url: item.url,
        claim: claim || 'No supported claim',
        verdict: claim ? 'supported' : 'unsupported',
        reason: 'Fixture release feed',
        quote: claim,
        fetchedAt: '2026-10-27',
        quality: 'primary',
      },
    ];
  });
  storeInfoReport(
    { db: w.s.db, attachmentsDir: w.s.attachmentsDir },
    {
      buildId: checker.buildId,
      teamId: w.teamId,
      createdBy: w.s.user.id,
      report: `Citation audit\n\n\`\`\`json\n${JSON.stringify({ claims })}\n\`\`\``,
    },
  );
  w.s.db
    .insert(tokenUsage)
    .values({ buildId: checker.buildId, model: 'gpt-6.1-sol', input: 1, output: 1 })
    .run();
}

function block(items: unknown): string {
  return `Today's findings.\n\n\`\`\`json\n${JSON.stringify(items)}\n\`\`\`\n`;
}

function item(n: number, extra: Record<string, unknown> = {}) {
  return {
    url: `https://example.com/post-${n}`,
    claim: `claim ${n}`,
    matches: `thread ${n}`,
    action: `do ${n}`,
    ...extra,
  };
}

function runIntake(w: World, now: number): void {
  planResearchIntake(w.s.svc, w.projectId, now);
}

function runReport(w: World, now: number): void {
  planChiefDigests(w.s.svc, now);
}

function finishedYesterday(w: World, at: number): void {
  w.s.db
    .insert(todo)
    .values({
      id: `done-${at}`,
      teamId: w.teamId,
      projectId: w.projectId,
      title: 'finished',
      phase: 'done',
      phaseAt: at - 20 * 3_600_000,
      seqNum: 900 + (at % 1000),
    })
    .run();
}

function postedReport(w: World, day: string, chiefId = 'chief-1'): ChiefReportContent {
  const row = w.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `${CHIEF_REPORT_ROW_ID_PREFIX}${reportIdOf(w, day, chiefId)}`))
    .get();
  if (!row) throw new Error(`no report for ${day}`);
  return chiefReportContentSchema.parse(JSON.parse(String(row.content)));
}

function reportIdOf(w: World, day: string, chiefId: string): string {
  const rec = w.s.db
    .select()
    .from(chiefReport)
    .where(and(eq(chiefReport.day, day), eq(chiefReport.chiefId, chiefId)))
    .get();
  if (!rec) throw new Error(`no report row for ${day}`);
  return rec.id;
}

describe('normalizeIntakeUrl', () => {
  test.each([
    ['HTTPS://WWW.Example.COM/a/b/?utm_source=x&ref=y&q=1#frag', 'https://example.com/a/b?q=1'],
    ['https://example.com/', 'https://example.com'],
    ['http://example.com/a?b=2&a=1', 'http://example.com/a?a=1&b=2'],
    ['https://github.com/o/r/releases/tag/v1.2.0', 'https://github.com/o/r/releases/tag/v1.2.0'],
  ])('%s', (raw, expected) => {
    expect(normalizeIntakeUrl(raw)).toBe(expected);
  });

  test.each(['ftp://example.com/a', 'javascript:alert(1)', 'not a url', ''])(
    'rejects %s',
    (raw) => {
      expect(normalizeIntakeUrl(raw)).toBeNull();
    },
  );
});

describe('parseIntakeItems', () => {
  test('reads the last fenced json block', () => {
    const text = `${block([item(1)])}\nmore\n${block([item(2), item(3)])}`;
    expect(parseIntakeItems(text).map((i) => i.claim)).toEqual(['claim 2', 'claim 3']);
  });

  test('malformed, missing or non-array json gives zero items', () => {
    expect(parseIntakeItems('no block here')).toEqual([]);
    expect(parseIntakeItems('```json\n{oops\n```')).toEqual([]);
    expect(parseIntakeItems('```json\n{"items":[]}\n```')).toEqual([]);
  });

  test('drops items without an http(s) url, with empty claims or of the wrong shape', () => {
    const text = block([
      item(1),
      item(2, { url: '' }),
      item(3, { url: 'ftp://x.org/a' }),
      item(4, { claim: '  ' }),
      { url: 'https://example.com/only-url' },
      'string',
      null,
    ]);
    expect(parseIntakeItems(text).map((i) => i.claim)).toEqual(['claim 1']);
  });
});

describe('daily intake tick', () => {
  test('is off when no project is configured', async () => {
    const w = await world();
    planResearchIntake(w.s.svc, null, D1_0630);
    expect(intakeTodos(w)).toHaveLength(0);
    expect(w.s.db.select().from(build).all()).toHaveLength(0);
  });

  test('waits for 06:00 local time', async () => {
    const w = await world();
    runIntake(w, D1_0530);
    expect(intakeTodos(w)).toHaveLength(0);
    runIntake(w, D1_0630);
    expect(intakeTodos(w)).toHaveLength(1);
  });

  test('opens one tier-2 info thread with the intake prompt on the Claude agent', async () => {
    const w = await world();
    runIntake(w, D1_0630);
    const [row] = intakeTodos(w);
    expect(row).toMatchObject({
      output: 'info',
      projectId: w.projectId,
      sourceRef: 'research-intake:2026-10-27',
    });
    const [first] = w.s.db.select().from(step).all();
    expect(first?.kind).toBe('session');
    expect(row?.spec).toContain('package.json');
    expect(row?.spec).toContain('```json');
    expect(row?.spec).toContain('claude-haiku-5-5');
    expect(row?.spec).toContain('3 到 5 个');
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
  });

  test('two ticks on the same day open one thread', async () => {
    const w = await world();
    runIntake(w, D1_0630);
    runIntake(w, D1_0830);
    runIntake(w, D1_2300);
    expect(intakeTodos(w)).toHaveLength(1);
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
  });

  test('a restarted scheduler on the same database still opens one thread', async () => {
    const w = await world();
    const options = { tickMs: 60_000, researchIntakeProjectId: w.projectId };
    await createScheduler(w.s.svc, options).tick(D1_0630);
    await createScheduler(w.s.svc, options).tick(D1_0830);
    expect(intakeTodos(w)).toHaveLength(1);
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
  });

  test('the next local day opens the next thread', async () => {
    const w = await world();
    runIntake(w, D1_0630);
    runIntake(w, D2_0630);
    expect(
      intakeTodos(w)
        .map((r) => r.sourceRef)
        .sort(),
    ).toEqual(['research-intake:2026-10-27', 'research-intake:2026-10-28']);
  });

  test('no session routing rule: a clear error, nothing created, and the scheduler survives', async () => {
    const w = await world();
    w.s.db.delete(routingRule).where(eq(routingRule.use, 'session')).run();
    expect(() => runIntake(w, D1_0630)).toThrow(/session routing rule/);
    expect(w.s.db.select().from(todo).all()).toHaveLength(0);
    await createScheduler(w.s.svc, {
      tickMs: 60_000,
      researchIntakeProjectId: w.projectId,
    }).tick(D1_0630);
    expect(w.s.db.select().from(todo).all()).toHaveLength(0);
  });

  test('a project that does not exist opens nothing', async () => {
    const w = await world();
    planResearchIntake(w.s.svc, 'missing-project', D1_0630);
    expect(w.s.db.select().from(todo).all()).toHaveLength(0);
  });

  test('seeds the prompt with at most 20 open thread titles and the last 7 days of items', async () => {
    const w = await world();
    for (let i = 1; i <= 25; i++) openThread(w, i, `open thread ${i}`, 'todo');
    openThread(w, 40, 'finished thread', 'done');
    openThread(w, 41, 'shelved thread', 'closed');
    const insertItem = (id: string, url: string, claim: string, createdAt: number) =>
      w.s.db
        .insert(retroProposal)
        .values({
          id,
          reportId: 'r',
          teamId: w.teamId,
          projectId: w.projectId,
          title: claim,
          what: claim,
          why: 'w',
          safeguard: 's',
          sourceKind: 'intake',
          sourceId: url,
          sourceLabel: 'example.com',
          createdAt,
        })
        .run();
    insertItem('i-recent', 'https://example.com/recent', 'recent claim', D1_0630 - 2 * DAY_MS);
    insertItem('i-old', 'https://example.com/old', 'old claim', D1_0630 - 9 * DAY_MS);
    runIntake(w, D1_0630);
    const spec = intakeTodos(w)[0]?.spec ?? '';
    expect(spec.match(/> open thread \d+/g)).toHaveLength(20);
    expect(spec).not.toContain('finished thread');
    expect(spec).not.toContain('shelved thread');
    expect(spec).toContain('https://example.com/recent recent claim');
    expect(spec).not.toContain('old claim');
  });

  test('an open stuck-research todo is not an intake search cue', async () => {
    const w = await world();
    openThread(w, 1, 'real work', 'todo');
    w.s.db
      .insert(todo)
      .values({
        id: 'todo-stuck-research',
        teamId: w.teamId,
        projectId: w.projectId,
        title: 'Research: Fix flaky export',
        phase: 'building',
        phaseAt: 500,
        seqNum: 9,
        sourceKind: 'research-stuck',
        sourceRef: 'build:0',
      })
      .run();
    runIntake(w, D1_0630);
    const spec = intakeTodos(w)[0]?.spec ?? '';
    expect(spec).toContain('real work');
    expect(spec).not.toContain('Research: Fix flaky export');
  });
});

describe('intake items in the 08:00 report', () => {
  async function dayWithIntake(report: string | null) {
    const w = await world();
    runIntake(w, D1_0630);
    const [intake] = intakeTodos(w);
    if (report !== null && intake) land(w, intake.id, report);
    finishedYesterday(w, D1_0830);
    return w;
  }

  test('a persisted pending delivery survives restart and two newer intake threads', async () => {
    const w = await dayWithIntake(null);
    const intake = intakeTodos(w)[0];
    if (!intake?.latestBuildId) throw new Error('intake missing');
    const report = block([item(1)]);
    land(w, intake.id, report, false);
    runReport(w, D1_0830);
    const madeAt = postedReport(w, '2026-10-27').madeAt;
    expect(postedReport(w, '2026-10-27').intake ?? []).toEqual([]);
    runIntake(w, D2_0630);
    runIntake(w, D2_0630 + DAY_MS);
    expect(intakeTodos(w)).toHaveLength(3);
    auditIntake(w, intake.latestBuildId, report);
    const options = { tickMs: 60_000, researchIntakeProjectId: null };
    await createScheduler(w.s.svc, options).tick(D2_0830 + DAY_MS);
    await createScheduler(w.s.svc, options).tick(D2_0830 + DAY_MS + 1000);
    const delivered = postedReport(w, '2026-10-27');
    expect(delivered.intake?.map((row) => row.claim)).toEqual(['claim 1']);
    expect(delivered.madeAt).toBe(madeAt);
    expect(delivered.yesterday.finishedCount).toBe(1);
    expect(w.s.db.select().from(retroProposal).all()).toHaveLength(1);
  });

  test('late audited intake creates the previously empty report without a second report row', async () => {
    const w = await world();
    runIntake(w, D1_0630);
    const intake = intakeTodos(w)[0];
    if (!intake) throw new Error('intake missing');
    runReport(w, D1_0830);
    const reportId = reportIdOf(w, '2026-10-27', 'chief-1');
    expect(
      w.s.db.select().from(chiefReport).where(eq(chiefReport.id, reportId)).get()?.status,
    ).toBe('empty');
    land(w, intake.id, block([item(1)]));
    await createScheduler(w.s.svc, { tickMs: 60_000, researchIntakeProjectId: null }).tick(
      D1_0830 + 1000,
    );
    expect(postedReport(w, '2026-10-27').intake?.map((row) => row.claim)).toEqual(['claim 1']);
    expect(w.s.db.select().from(chiefReport).all()).toHaveLength(1);
    expect(
      w.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, `${CHIEF_REPORT_ROW_ID_PREFIX}${reportId}`))
        .all(),
    ).toHaveLength(1);
  });

  test('malformed delivery records rotate out of a bounded batch so ready work is not starved', async () => {
    const w = await dayWithIntake(null);
    runReport(w, D1_0830);
    const rec = w.s.db
      .select()
      .from(chiefReport)
      .where(eq(chiefReport.id, reportIdOf(w, '2026-10-27', 'chief-1')))
      .get();
    if (!rec?.inputs) throw new Error('report inputs missing');
    for (let i = 0; i < 5; i++) {
      const id = `broken-${i}`;
      w.s.db
        .insert(chiefReport)
        .values({
          id,
          chiefId: 'chief-1',
          teamId: w.teamId,
          day: `2026-10-0${i + 1}`,
          threadId: 'thread-main',
          status: 'posted',
          inputs: rec.inputs,
          createdAt: 0,
        })
        .run();
      w.s.db
        .insert(message)
        .values({
          id: `research-intake-delivery:${id}`,
          conversationId: `research-intake-delivery:${id}`,
          role: 'system',
          content: { todoIds: 'malformed' },
          createdAt: 0,
        })
        .run();
    }
    const intake = intakeTodos(w)[0];
    if (!intake) throw new Error('intake missing');
    land(w, intake.id, block([item(1)]));
    const options = { tickMs: 60_000, researchIntakeProjectId: null };
    await createScheduler(w.s.svc, options).tick(D1_0830 + 1000);
    expect(postedReport(w, '2026-10-27').intake ?? []).toEqual([]);
    await createScheduler(w.s.svc, options).tick(D1_0830 + 2000);
    expect(postedReport(w, '2026-10-27').intake?.map((row) => row.claim)).toEqual(['claim 1']);
  });

  test('late audited items share the original five-item budget', async () => {
    const w = await world();
    runIntake(w, D1_0630);
    const first = intakeTodos(w)[0];
    if (!first) throw new Error('first source missing');
    land(w, first.id, block([item(1), item(2), item(3), item(4)]));
    runIntake(w, D2_0630);
    const second = intakeTodos(w).find((row) => row.id !== first.id);
    if (!second?.latestBuildId) throw new Error('second source missing');
    const delayed = block([item(5), item(6), item(7)]);
    land(w, second.id, delayed, false);
    runReport(w, D2_0830);
    expect(postedReport(w, '2026-10-28').intake).toHaveLength(4);
    auditIntake(w, second.latestBuildId, delayed);
    await createScheduler(w.s.svc, { tickMs: 60_000, researchIntakeProjectId: null }).tick(
      D2_0830 + 1000,
    );
    expect(postedReport(w, '2026-10-28').intake).toHaveLength(5);
  });

  test('lists the items as draft intake rows, not as retro proposals', async () => {
    const w = await dayWithIntake(block([item(1), item(2)]));
    runReport(w, D1_0830);
    const report = postedReport(w, '2026-10-27');
    expect(report.intake?.map((i) => i.url)).toEqual([
      'https://example.com/post-1',
      'https://example.com/post-2',
    ]);
    expect(report.intake?.[0]).toMatchObject({
      claim: 'claim 1',
      matches: 'thread 1',
      action: 'do 1',
      status: 'draft',
      todoId: null,
      projectId: w.projectId,
    });
    expect(report.retro).toEqual([]);
    const rows = w.s.db.select().from(retroProposal).all();
    expect(rows.map((r) => r.sourceKind)).toEqual(['intake', 'intake']);
    expect(rows[0]?.sourceTodoId).toBe(intakeTodos(w)[0]?.id);
  });

  test('caps the list at the intake maximum', async () => {
    const w = await dayWithIntake(block(Array.from({ length: 8 }, (_, i) => item(i + 1))));
    runReport(w, D1_0830);
    expect(CHIEF_REPORT_INTAKE_MAX).toBe(5);
    expect(postedReport(w, '2026-10-27').intake).toHaveLength(5);
  });

  test('malformed or missing json: zero items, the report still posts', async () => {
    for (const text of ['no block', '```json\n{oops\n```']) {
      const w = await dayWithIntake(text);
      runReport(w, D1_0830);
      const report = postedReport(w, '2026-10-27');
      expect(report.intake ?? []).toEqual([]);
      expect(report.yesterday.finishedCount).toBe(1);
    }
  });

  test('items without a usable url are dropped', async () => {
    const w = await dayWithIntake(
      block([item(1, { url: '' }), item(2, { url: 'ftp://x.org/a' }), item(3)]),
    );
    runReport(w, D1_0830);
    expect(postedReport(w, '2026-10-27').intake?.map((i) => i.claim)).toEqual(['claim 3']);
  });

  test('a url seen in the last 7 days is dropped after normalization, an older one is not', async () => {
    const w = await dayWithIntake(
      block([
        item(1, { url: 'https://WWW.example.com/post-1/?utm_source=feed#top' }),
        item(2),
        item(3, { url: 'https://example.com/post-3' }),
        item(4, { url: 'https://example.com/post-4' }),
      ]),
    );
    w.s.db
      .insert(chiefReport)
      .values({
        id: 'earlier',
        chiefId: 'chief-1',
        teamId: w.teamId,
        day: '2026-10-20',
        threadId: 'thread-main',
        status: 'posted',
        createdAt: 1,
      })
      .run();
    const seen = (id: string, url: string, createdAt: number) =>
      w.s.db
        .insert(retroProposal)
        .values({
          id,
          reportId: 'earlier',
          teamId: w.teamId,
          projectId: w.projectId,
          title: 't',
          what: 'w',
          why: 'y',
          safeguard: 's',
          sourceKind: 'intake',
          sourceId: url,
          sourceLabel: 'example.com',
          status: 'dismissed',
          createdAt,
        })
        .run();
    seen('s1', 'https://example.com/post-1', D1_0830 - 3 * DAY_MS);
    seen('s3', 'https://example.com/post-3', D1_0830 - 10 * DAY_MS);
    runReport(w, D1_0830);
    expect(postedReport(w, '2026-10-27').intake?.map((i) => i.claim)).toEqual([
      'claim 2',
      'claim 3',
      'claim 4',
    ]);
  });

  test('a duplicate inside one report is listed once', async () => {
    const w = await dayWithIntake(block([item(1), item(1, { claim: 'again' })]));
    runReport(w, D1_0830);
    expect(postedReport(w, '2026-10-27').intake).toHaveLength(1);
  });

  test('a late source updates the original report and is not repeated on the next day', async () => {
    const w = await dayWithIntake(null);
    runReport(w, D1_0830);
    expect(postedReport(w, '2026-10-27').intake ?? []).toEqual([]);
    const [intake] = intakeTodos(w);
    if (intake) land(w, intake.id, block([item(1)]));
    runIntake(w, D2_0630);
    expect(postedReport(w, '2026-10-27').intake?.map((i) => i.claim)).toEqual(['claim 1']);
    finishedYesterday(w, D2_0830);
    runReport(w, D2_0830);
    expect(postedReport(w, '2026-10-28').intake ?? []).toEqual([]);
  });

  test('items already listed are not listed again by a later report', async () => {
    const w = await dayWithIntake(block([item(1)]));
    runReport(w, D1_0830);
    runIntake(w, D2_0630);
    finishedYesterday(w, D2_0830);
    runReport(w, D2_0830);
    expect(postedReport(w, '2026-10-28').intake ?? []).toEqual([]);
    expect(w.s.db.select().from(retroProposal).all()).toHaveLength(1);
  });

  test('a consumed thread is not listed again after the 7-day url window passes', async () => {
    const w = await dayWithIntake(block([item(1)]));
    runReport(w, D1_0830);
    const later = D1_0830 + 9 * DAY_MS;
    finishedYesterday(w, later);
    runReport(w, later);
    expect(w.s.db.select().from(retroProposal).all()).toHaveLength(1);
  });

  test('a day with only intake still posts a report', async () => {
    const w = await world();
    runIntake(w, D1_0630);
    const [intake] = intakeTodos(w);
    if (intake) land(w, intake.id, block([item(1)]));
    runReport(w, D1_0830);
    expect(postedReport(w, '2026-10-27').intake).toHaveLength(1);
  });
});

describe('several Coordinators in one team', () => {
  async function twoCoordinators() {
    const w = await world();
    const second = addCoordinator(w, 2);
    runIntake(w, D1_0630);
    const [intake] = intakeTodos(w);
    if (intake) land(w, intake.id, block([item(1), item(2)]));
    runReport(w, D1_0830);
    return { w, second };
  }

  test('each Coordinator gets the same items in its own report', async () => {
    const { w } = await twoCoordinators();
    const urls = (chiefId: string) =>
      postedReport(w, '2026-10-27', chiefId).intake?.map((i) => i.url);
    expect(urls('chief-1')).toEqual(['https://example.com/post-1', 'https://example.com/post-2']);
    expect(urls('chief-2')).toEqual(urls('chief-1'));
  });

  test('each Coordinator accepts its own item and cannot decide the other one', async () => {
    const { w, second } = await twoCoordinators();
    const [mine] = postedReport(w, '2026-10-27', 'chief-1').intake ?? [];
    const [theirs] = postedReport(w, '2026-10-27', 'chief-2').intake ?? [];
    if (!mine || !theirs) throw new Error('missing items');
    expect(() => decideRetroProposal(second, w.teamId, mine.id, 'accept')).toThrow(
      /not found|404|retro proposal/,
    );
    expect(decideRetroProposal(w.s.svc, w.teamId, mine.id, 'accept')).toMatchObject({
      status: 'accepted',
    });
    expect(decideRetroProposal(second, w.teamId, theirs.id, 'accept')).toMatchObject({
      status: 'accepted',
    });
  });

  test('a repeat for the same Coordinator is still dropped', async () => {
    const { w } = await twoCoordinators();
    runIntake(w, D2_0630);
    finishedYesterday(w, D2_0830);
    runReport(w, D2_0830);
    for (const chiefId of ['chief-1', 'chief-2'])
      expect(postedReport(w, '2026-10-28', chiefId).intake ?? []).toEqual([]);
    expect(w.s.db.select().from(retroProposal).all()).toHaveLength(4);
  });
});

describe('accepting an intake item on a GitHub-backed project', () => {
  test('opens an unstarted thread of its own kind and files no issue', async () => {
    const calls: string[] = [];
    const w = await world({ github: { calls } });
    runIntake(w, D1_0630);
    const [intake] = intakeTodos(w);
    if (intake) land(w, intake.id, block([item(1)]));
    runReport(w, D1_0830);
    const [first] = postedReport(w, '2026-10-27').intake ?? [];
    if (!first) throw new Error('no intake item');
    const res = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/retro-proposals/${first.id}/accept`,
    );
    expect(res.status).toBe(200);
    await flushSelfIssueWrites();
    const accepted = w.s.db
      .select()
      .from(retroProposal)
      .where(eq(retroProposal.id, first.id))
      .get();
    const created = w.s.db
      .select()
      .from(todo)
      .where(eq(todo.id, String(accepted?.todoId)))
      .get();
    expect(created).toMatchObject({
      sourceKind: 'research-intake-item',
      sourceRef: 'https://example.com/post-1',
      phase: 'todo',
    });
    expect(calls).toEqual([]);
  });
});

describe('accepting and dismissing intake items', () => {
  async function listed() {
    const w = await dayWithIntake();
    return w;
  }

  async function dayWithIntake() {
    const w = await world();
    runIntake(w, D1_0630);
    const [intake] = intakeTodos(w);
    if (intake) land(w, intake.id, block([item(1), item(2), item(3)]));
    runReport(w, D1_0830);
    return w;
  }

  async function decide(w: World, itemId: string, decision: 'accept' | 'dismiss') {
    return req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/retro-proposals/${itemId}/${decision}`,
    );
  }

  test('accepting opens an unstarted thread with the source url; nothing is built or filed', async () => {
    const w = await listed();
    const [first] = postedReport(w, '2026-10-27').intake ?? [];
    if (!first) throw new Error('no intake item');
    const buildsBefore = w.s.db.select().from(build).all().length;
    const res = await decide(w, first.id, 'accept');
    expect(res.status).toBe(200);
    const accepted = w.s.db
      .select()
      .from(retroProposal)
      .where(eq(retroProposal.id, first.id))
      .get();
    expect(accepted?.status).toBe('accepted');
    const created = w.s.db
      .select()
      .from(todo)
      .where(eq(todo.id, String(accepted?.todoId)))
      .get();
    expect(created).toMatchObject({ phase: 'todo', projectId: w.projectId, latestBuildId: null });
    expect(created?.spec).toContain('https://example.com/post-1');
    expect(created?.spec).toContain('do 1');
    expect(w.s.db.select().from(build).all()).toHaveLength(buildsBefore);
    const after = postedReport(w, '2026-10-27').intake;
    expect(after?.[0]).toMatchObject({ status: 'accepted', todoId: accepted?.todoId });
  });

  test('dismissing creates nothing and a decided item cannot be decided again', async () => {
    const w = await listed();
    const [first] = postedReport(w, '2026-10-27').intake ?? [];
    if (!first) throw new Error('no intake item');
    const todosBefore = w.s.db.select().from(todo).all().length;
    expect((await decide(w, first.id, 'dismiss')).status).toBe(200);
    expect(w.s.db.select().from(todo).all()).toHaveLength(todosBefore);
    expect((await decide(w, first.id, 'accept')).status).toBe(409);
  });

  test('the 14-day tally counts accepted, dismissed and undecided items from stored rows', async () => {
    const w = await listed();
    const [a, b] = postedReport(w, '2026-10-27').intake ?? [];
    if (!a || !b) throw new Error('missing items');
    await decide(w, a.id, 'accept');
    await decide(w, b.id, 'dismiss');
    expect(intakeTally(w.s.db, w.teamId, D1_0830 - 14 * DAY_MS)).toEqual({
      accepted: 1,
      dismissed: 1,
      ignored: 1,
    });
    expect(intakeTally(w.s.db, w.teamId, D1_0830 + DAY_MS)).toEqual({
      accepted: 0,
      dismissed: 0,
      ignored: 0,
    });
  });
});

import type { ChiefReportContent } from '@cairn/shared';
import {
  CHIEF_REPORT_INTAKE_MAX,
  CHIEF_REPORT_ROW_ID_PREFIX,
  chiefReportContentSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agent,
  build,
  chiefMessage,
  chiefReport,
  chief as chiefTable,
  chiefThread,
  message,
  retroProposal,
  todo,
} from '../src/db/schema.js';
import { planChiefDigests } from '../src/services/chief-digest.js';
import { intakeTally, normalizeIntakeUrl, parseIntakeItems } from '../src/services/intake-items.js';
import { planResearchIntake } from '../src/services/research-intake.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, postProject, req } from './helpers.js';

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

async function world() {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'cairn');
  const teamId = s.team.id;
  s.db
    .insert(agent)
    .values({
      id: 'agent-opus',
      teamId,
      displayName: 'opus',
      provider: 'claude-code',
      modelId: 'claude-opus-5-5',
    })
    .run();
  s.db
    .insert(agent)
    .values({ id: 'agent-coord', teamId, displayName: 'coord', provider: 'stub-gw', modelId: 'm' })
    .run();
  s.db
    .insert(chiefTable)
    .values({
      id: 'chief-1',
      userId: s.user.id,
      teamId,
      agentId: 'agent-coord',
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

function land(w: World, todoId: string, report: string): void {
  const buildId = w.s.db.select().from(todo).where(eq(todo.id, todoId)).get()?.latestBuildId;
  if (!buildId) throw new Error('intake todo has no build');
  w.s.db
    .insert(message)
    .values({
      id: `info-report-${buildId}`,
      conversationId: buildId,
      role: 'system',
      content: JSON.stringify({
        kind: 'info-report',
        attachmentId: 'att',
        attachmentToken: 'tok',
        content: report,
      }),
      createdAt: 1,
    })
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

function postedReport(w: World, day: string): ChiefReportContent {
  const row = w.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `${CHIEF_REPORT_ROW_ID_PREFIX}${reportIdOf(w, day)}`))
    .get();
  if (!row) throw new Error(`no report for ${day}`);
  return chiefReportContentSchema.parse(JSON.parse(String(row.content)));
}

function reportIdOf(w: World, day: string): string {
  const rec = w.s.db.select().from(chiefReport).where(eq(chiefReport.day, day)).get();
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
    expect(row?.assignment).toMatchObject({ build: { agentId: 'agent-opus' } });
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

  test('no Claude Code agent: a clear error, nothing created, and the scheduler survives', async () => {
    const w = await world();
    w.s.db.delete(agent).where(eq(agent.id, 'agent-opus')).run();
    expect(() => runIntake(w, D1_0630)).toThrow(/Claude Code agent/);
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

  test('a thread still running at 08:00 posts the report without intake and the items show next day', async () => {
    const w = await dayWithIntake(null);
    runReport(w, D1_0830);
    expect(postedReport(w, '2026-10-27').intake ?? []).toEqual([]);
    const [intake] = intakeTodos(w);
    if (intake) land(w, intake.id, block([item(1)]));
    runIntake(w, D2_0630);
    runReport(w, D2_0830);
    expect(postedReport(w, '2026-10-28').intake?.map((i) => i.claim)).toEqual(['claim 1']);
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

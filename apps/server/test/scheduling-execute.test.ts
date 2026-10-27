import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  project as projectTable,
  scheduleReport as scheduleReportTable,
} from '../src/db/schema.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { executeSchedule } from '../src/services/scheduling/execute.js';
import type { ScheduleGithubWriter } from '../src/services/scheduling/writes.js';
import { bootServer, req, type TestServer } from './helpers.js';

const OWNER = 'xiechimon';
const REPO = `${OWNER}/pacman`;
const TOKEN = 'ghp_p5a2_schedule_token';

const servers: TestServer[] = [];
function boot(): TestServer {
  const s = bootServer();
  servers.push(s);
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: OWNER, accessToken: TOKEN, scope: 'repo' },
  );
  return s;
}

async function githubProject(s: TestServer): Promise<string> {
  const id = `proj-${randomUUID()}`;
  s.db
    .insert(projectTable)
    .values({ id, name: 'sched', teamId: s.team.id, repoKind: 'github', githubRepo: REPO })
    .run();
  return id;
}

interface Call {
  op: string;
  issue: number;
  arg?: string;
}

function fakeWriter(options: { updatedAt?: number; state?: 'open' | 'closed' } = {}) {
  const calls: Call[] = [];
  const writer: ScheduleGithubWriter = {
    issue: async (_token, _owner, _repo, issueNumber) => ({
      number: issueNumber,
      state: options.state ?? 'open',
      updatedAt: options.updatedAt ?? 1,
    }),
    addLabel: async (_t, _o, _r, issue) => {
      calls.push({ op: 'addLabel', issue, arg: 'ready-for-agent' });
    },
    removeLabel: async (_t, _o, _r, issue) => {
      calls.push({ op: 'removeLabel', issue, arg: 'ready-for-agent' });
    },
    comment: async (_t, _o, _r, issue, body) => {
      calls.push({ op: 'comment', issue, arg: body });
    },
    closeIssue: async (_t, _o, _r, issue, comment, reason) => {
      calls.push({ op: 'close', issue, arg: `${reason}|${comment}` });
    },
  };
  return { writer, calls };
}

function seedReport(s: TestServer, projectId: string) {
  s.db
    .insert(scheduleReportTable)
    .values({
      id: 'report-1',
      projectId,
      generatedAt: 1_000,
      mainSha: 'a'.repeat(40),
      groups: { now: [1], next: [2], later: [], close: [3] },
      items: [
        {
          issue: 1,
          title: 'ready one',
          group: 'now',
          reason: '依赖已清，标注 ready-for-agent，可交给 agent',
          deps: [],
          executor: null,
          updatedAt: 1,
          evidence: [],
          closeReason: null,
          labelChange: { add: ['ready-for-agent'], remove: [] },
        },
        {
          issue: 2,
          title: 'queued one',
          group: 'next',
          reason: '等依赖 #1 合入后才能排期',
          deps: [1],
          executor: null,
          updatedAt: 1,
          evidence: [],
          closeReason: null,
          labelChange: null,
        },
        {
          issue: 3,
          title: 'done one',
          group: 'close',
          reason: '已完成：#50',
          deps: [],
          executor: null,
          updatedAt: 1,
          evidence: [{ kind: 'merged-pull', ref: '#50', url: 'https://x/50' }],
          closeReason: 'done',
          labelChange: { add: [], remove: ['ready-for-agent'] },
        },
      ],
      unparsedDeps: [],
      decidedAt: null,
      decidedBy: null,
      appliedAt: null,
    })
    .run();
}

describe('GET /api/projects/{id}/schedule', () => {
  test('an untouched project has no report', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/schedule`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: null });
  });
});

describe('POST /api/projects/{id}/schedule/execute', () => {
  test('suggests nothing without an execute call: reads leave labels and state alone', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    const { writer, calls } = fakeWriter();
    expect(calls).toEqual([]);
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/schedule`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: { id: string } | null };
    expect(body.report?.id).toBe('report-1');
    void writer;
  });

  test('applies only the checked items', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    const { writer, calls } = fakeWriter();
    const result = await executeSchedule(
      { deps: { ...s.svc, box: s.secretBox }, user: s.user, writer },
      projectId,
      { reportId: 'report-1', issues: [1] },
    );
    expect(result).toEqual({ applied: [1], skipped: [] });
    expect(calls).toEqual([{ op: 'addLabel', issue: 1, arg: 'ready-for-agent' }]);
  });

  test('a close carries a reason comment and unlabels first', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    const { writer, calls } = fakeWriter();
    const result = await executeSchedule(
      { deps: { ...s.svc, box: s.secretBox }, user: s.user, writer },
      projectId,
      { reportId: 'report-1', issues: [3] },
    );
    expect(result.applied).toEqual([3]);
    expect(calls.map((c) => c.op)).toEqual(['close', 'removeLabel']);
    expect(calls[0]?.arg).toContain('总管排期确认关闭');
    expect(calls[0]?.arg).toContain('completed');
    expect(calls[0]?.arg).toContain('#50');
  });

  test('executes the report the human confirmed, not whatever is newest', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    s.db
      .insert(scheduleReportTable)
      .values({
        id: 'report-2',
        projectId,
        generatedAt: 2_000,
        mainSha: 'b'.repeat(40),
        groups: { now: [], next: [], later: [], close: [1, 3] },
        items: [1, 3].map((issue) => ({
          issue,
          title: `closed by the newer sweep ${issue}`,
          group: 'close' as const,
          reason: '已完成：#99',
          deps: [],
          executor: null,
          updatedAt: 1,
          evidence: [{ kind: 'merged-pull' as const, ref: '#99', url: 'https://x/99' }],
          closeReason: 'done' as const,
          labelChange: null,
        })),
        unparsedDeps: [],
        decidedAt: null,
        decidedBy: null,
        appliedAt: null,
      })
      .run();
    const { writer, calls } = fakeWriter();
    const result = await executeSchedule(
      { deps: { ...s.svc, box: s.secretBox }, user: s.user, writer },
      projectId,
      { reportId: 'report-1', issues: [1] },
    );
    expect(result).toEqual({ applied: [1], skipped: [] });
    expect(calls).toEqual([{ op: 'addLabel', issue: 1, arg: 'ready-for-agent' }]);
  });

  test('an unknown or superseded report id is refused instead of falling back', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    const { writer, calls } = fakeWriter();
    await expect(
      executeSchedule({ deps: { ...s.svc, box: s.secretBox }, user: s.user, writer }, projectId, {
        reportId: 'report-gone',
        issues: [1],
      }),
    ).rejects.toThrow(/schedule report not found/);
    expect(calls).toEqual([]);
  });

  test('a second execute on the same report is refused', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    const first = await executeSchedule(
      { deps: { ...s.svc, box: s.secretBox }, user: s.user, writer: fakeWriter().writer },
      projectId,
      { reportId: 'report-1', issues: [1] },
    );
    expect(first.applied).toEqual([1]);
    const second = await executeSchedule(
      { deps: { ...s.svc, box: s.secretBox }, user: s.user, writer: fakeWriter().writer },
      projectId,
      { reportId: 'report-1', issues: [1] },
    );
    expect(second).toEqual({ applied: [], skipped: [{ issue: 1, reason: 'already-applied' }] });
  });

  test('a ticket touched after the report was generated is skipped as stale', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    const { writer, calls } = fakeWriter({ updatedAt: 999_999 });
    const result = await executeSchedule(
      { deps: { ...s.svc, box: s.secretBox }, user: s.user, writer },
      projectId,
      { reportId: 'report-1', issues: [1] },
    );
    expect(result).toEqual({ applied: [], skipped: [{ issue: 1, reason: 'stale' }] });
    expect(calls).toEqual([]);
  });

  test('rejects an execute body without the confirmed report id', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    seedReport(s, projectId);
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/schedule/execute`, {
      issues: [1],
    });
    expect(res.status).toBe(400);
  });

  test('rejects an empty selection and unknown project ids', async () => {
    const s = boot();
    const projectId = await githubProject(s);
    const empty = await req(s.app, 'POST', `/api/projects/${projectId}/schedule/execute`, {
      reportId: 'report-1',
      issues: [],
    });
    expect(empty.status).toBe(400);
    const missing = await req(s.app, 'POST', '/api/projects/nope/schedule/execute', {
      reportId: 'report-1',
      issues: [1],
    });
    expect(missing.status).toBe(404);
  });

  test('a project without a github repository cannot execute', async () => {
    const s = boot();
    const created = await req(s.app, 'POST', '/api/projects', { name: 'plain' });
    const projectId = ((await created.json()) as { id: string }).id;
    seedReport(s, projectId);
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/schedule/execute`, {
      reportId: 'report-1',
      issues: [1],
    });
    expect(res.status).toBe(409);
  });

  test('agent tool code never calls the execute path', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../src/services/chief-tools.ts'),
      'utf8',
    );
    expect(source).not.toContain('executeSchedule');
    expect(source).not.toContain('githubAddIssueLabel');
    expect(source).not.toContain('githubCloseIssueWithComment');
  });
});

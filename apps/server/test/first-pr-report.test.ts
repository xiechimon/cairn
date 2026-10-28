import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIRST_PR_DISCUSSION_CATEGORY, firstPrDiscussionUrl } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { build, project, todo } from '../src/db/schema.js';
import {
  markFirstPrPromptDue,
  readFirstPrReportPrompt,
  setFirstPrReportPrompt,
} from '../src/services/first-pr-report.js';
import { bootServer, req } from './helpers.js';

function seedPrBuild(s: ReturnType<typeof bootServer>, prNumber: number, prUrl: string) {
  const projectId = `proj-${prNumber}`;
  const todoId = `todo-${prNumber}`;
  const buildId = `build-${prNumber}`;
  const now = 1_000 + prNumber;
  s.db.insert(project).values({ id: projectId, teamId: s.team.id, name: 'demo' }).run();
  s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'task',
      spec: 'spec',
      phase: 'done',
      phaseAt: now,
      seqNum: prNumber,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      prUrl,
      prNumber,
      createdAt: now,
    })
    .run();
  return { projectId, todoId, buildId };
}

const PR_URL = 'https://github.com/example/secret-repo/pull/7';

describe('with the setting off, the first PR does not mark the prompt due', () => {
  test('marking due is a no-op while enabled is false', () => {
    const s = bootServer();
    try {
      const { buildId } = seedPrBuild(s, 7, PR_URL);
      markFirstPrPromptDue(s.db, buildId);
      expect(readFirstPrReportPrompt(s.db, s.team.id)).toMatchObject({
        enabled: false,
        due: false,
        firstPrNumber: null,
      });
    } finally {
      s.dispose();
    }
  });
});

describe('with the setting on, the first PR marks it due once; later PRs do not mark it again', () => {
  test('the first recorded PR sets due and keeps its number, a second one changes nothing', () => {
    const s = bootServer();
    try {
      setFirstPrReportPrompt(s.db, s.team.id, { enabled: true });
      const first = seedPrBuild(s, 7, PR_URL);
      markFirstPrPromptDue(s.db, first.buildId);
      const afterFirst = readFirstPrReportPrompt(s.db, s.team.id);
      expect(afterFirst.due).toBe(true);
      expect(afterFirst.firstPrNumber).toBe(7);

      const second = seedPrBuild(s, 8, 'https://github.com/example/secret-repo/pull/8');
      markFirstPrPromptDue(s.db, second.buildId);
      expect(readFirstPrReportPrompt(s.db, s.team.id)).toEqual(afterFirst);
    } finally {
      s.dispose();
    }
  });

  test('a dismissed prompt is not marked due again', () => {
    const s = bootServer();
    try {
      setFirstPrReportPrompt(s.db, s.team.id, { enabled: true, dismissed: true });
      const { buildId } = seedPrBuild(s, 7, PR_URL);
      markFirstPrPromptDue(s.db, buildId);
      expect(readFirstPrReportPrompt(s.db, s.team.id).due).toBe(false);
    } finally {
      s.dispose();
    }
  });
});

describe('no code path in this feature performs an outbound request', () => {
  test('marking due and building the link make zero fetch calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const s = bootServer();
    try {
      setFirstPrReportPrompt(s.db, s.team.id, { enabled: true });
      const { buildId } = seedPrBuild(s, 7, PR_URL);
      markFirstPrPromptDue(s.db, buildId);
      firstPrDiscussionUrl({ daysToFirstPr: 3 });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      s.dispose();
      fetchSpy.mockRestore();
    }
  });
});

describe('the prompt over HTTP', () => {
  test('a fresh team reports it off and not due', async () => {
    const s = bootServer();
    try {
      const body = (await (await req(s.app, 'GET', '/api/teams')).json()) as unknown[];
      expect((body[0] as { firstPrReportPrompt: unknown }).firstPrReportPrompt).toEqual({
        enabled: false,
        due: false,
        dismissedAt: null,
        firstPrAt: null,
        firstPrNumber: null,
      });
    } finally {
      s.dispose();
    }
  });

  test('PATCH enables and then dismisses it', async () => {
    const s = bootServer();
    try {
      const on = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
        firstPrReportPrompt: { enabled: true },
      });
      expect(on.status).toBe(200);
      expect((await on.json()) as unknown).toMatchObject({
        firstPrReportPrompt: { enabled: true, due: false, dismissedAt: null },
      });

      const off = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
        firstPrReportPrompt: { dismissed: true },
      });
      expect(off.status).toBe(200);
      expect((await off.json()) as unknown).toMatchObject({
        firstPrReportPrompt: { enabled: true, dismissedAt: expect.any(Number) as number },
      });
    } finally {
      s.dispose();
    }
  });

  test('an unknown team id is a 404', async () => {
    const s = bootServer();
    try {
      const res = await req(s.app, 'PATCH', '/api/teams/not-mine', {
        firstPrReportPrompt: { enabled: true },
      });
      expect(res.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('a non-boolean flag is a 400', async () => {
    const s = bootServer();
    try {
      const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
        firstPrReportPrompt: { enabled: 'yes' },
      });
      expect(res.status).toBe(400);
    } finally {
      s.dispose();
    }
  });
});

describe('the privacy document matches the link builder', () => {
  test('every documented field is one the builder emits, and the builder emits nothing else', () => {
    const doc = readFileSync(join(import.meta.dirname, '../../../docs/privacy.md'), 'utf8');
    const section = doc.split('## The prefilled post')[1];
    expect(section).toBeDefined();
    const documented = [...(section ?? '').matchAll(/^- `([a-z-]+)`/gm)].map((m) => m[1]);
    const body = new URL(firstPrDiscussionUrl({ daysToFirstPr: 3 })).searchParams.get('body') ?? '';
    const emitted = body
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(':')[0]);
    expect([...emitted].sort()).toEqual([...documented].sort());
  });

  test('the document states that Cairn itself sends nothing', () => {
    const doc = readFileSync(join(import.meta.dirname, '../../../docs/privacy.md'), 'utf8');
    expect(doc).toMatch(/Cairn sends nothing/i);
  });
});

describe('the discussions repository files exist', () => {
  const root = join(import.meta.dirname, '../../..');
  test.each([
    '.github/DISCUSSION_TEMPLATE/first-pr.yml',
    '.github/DISCUSSION_TEMPLATE/q-a.yml',
    'docs/community/welcome.md',
  ])('%s', (path) => {
    const text = readFileSync(join(root, path), 'utf8');
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('the first-PR discussion template labels its category', () => {
    const text = readFileSync(join(root, '.github/DISCUSSION_TEMPLATE/first-pr.yml'), 'utf8');
    expect(text).toContain(`labels: ["${FIRST_PR_DISCUSSION_CATEGORY}"]`);
  });
});

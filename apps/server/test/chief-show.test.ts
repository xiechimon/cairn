import { chatBlockSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build as buildTable, todo as todoTable } from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { bootServer, insertMachine, postProject, req, type TestServer } from './helpers.js';

const COUPON = {
  path: 'apps/server/src/services/coupon-split.ts',
  additions: 3,
  deletions: 1,
  hunks: [
    {
      header: '@@ -14,4 +14,6 @@',
      lines: [
        ' export function splitCoupon(lines, coupon) {',
        '-  return lines.map((line) => roundCents(line.total * coupon.rate))',
        '+  const orderTotal = lines.reduce((sum, line) => sum + line.total, 0)',
        '+  const orderDiscount = roundCents(orderTotal * coupon.rate)',
        '+  return settleRemainder(lines, orderDiscount)',
        ' }',
      ],
    },
  ],
};

async function withBuiltTodo(): Promise<TestServer & { todoId: string }> {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'Fix coupon', spec: '' })
  ).json()) as { id: string };
  insertMachine(s);
  startBuilds(s.svc, { projectId, todoIds: [created.id] });
  const row = s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
  s.db
    .update(buildTable)
    .set({ changes: [COUPON] })
    .where(eq(buildTable.id, row?.latestBuildId ?? ''))
    .run();
  return { ...s, todoId: created.id };
}

function run(s: TestServer, name: string, params: Record<string, unknown>) {
  return executeChiefTool(
    {
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      box: s.secretBox,
      user: s.user,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    {
      teamId: s.team.id,
      userId: s.user.id,
      chiefId: 'chief-x',
      threadId: 'thread-x',
      chiefAgentId: null,
      conversationId: 'conv-x',
    },
    name,
    params,
  );
}

describe('Coordinator reply blocks', () => {
  test('show_diff answers with the key lines of the task build, its note under them and a plain-text fallback', async () => {
    const s = await withBuiltTodo();
    try {
      const note = 'The discount is taken once per order, then split across lines.';
      const block = chatBlockSchema.parse(
        JSON.parse(
          await run(s, 'show_diff', {
            todoId: s.todoId,
            focus: [{ path: COUPON.path, start: 15, end: 17, note }],
          }),
        ),
      );
      expect(block.block).toBe('diff');
      if (block.block !== 'diff') return;
      expect(block.glance).toMatchObject({ todoId: s.todoId, path: COUPON.path });
      expect(block.glance.lines.map((line) => line.kind)).toEqual([
        'del',
        'add',
        'add',
        'add',
        'note',
      ]);
      expect(block.glance.lines.at(-1)?.text).toBe(note);
      expect(block.fallbackMarkdown).toContain('```diff');
      expect(block.fallbackMarkdown).toContain('+  const orderDiscount');
      expect(block.fallbackMarkdown).toContain(note);
    } finally {
      s.dispose();
    }
  });

  test('show_chart refuses a series whose values do not match the categories', async () => {
    const s = bootServer();
    try {
      await expect(
        run(s, 'show_chart', {
          type: 'bar',
          title: 'p95',
          categories: ['a', 'b'],
          series: [{ name: 'before', values: [1] }],
        }),
      ).rejects.toThrow(/show_chart rejected: series\.0\.values/);
      const ok = chatBlockSchema.parse(
        JSON.parse(
          await run(s, 'show_chart', {
            type: 'bar',
            title: 'p95',
            unit: 'ms',
            categories: ['a', 'b'],
            series: [{ name: 'before', values: [3, 4], role: 'before' }],
          }),
        ),
      );
      expect(ok.fallbackMarkdown).toContain('| a | 3 |');
    } finally {
      s.dispose();
    }
  });
});

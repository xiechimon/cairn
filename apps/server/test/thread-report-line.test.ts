import { THREAD_REPORT_LINE_MAX, threadReportContentSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build, chief, chiefMessage, step, todo } from '../src/db/schema.js';
import { applyBuildStepAction, startBuilds } from '../src/services/builds.js';
import { coordinatorThreadRow, ensureChief } from '../src/services/chief.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { setTodoPhase } from '../src/services/todos.js';
import { recordThreadReportLine } from '../src/services/worker-questions.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

function deps() {
  return {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
}

function startSession() {
  const todoId = 'report-todo';
  H.s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Export the board',
      spec: 'Add an export.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 3,
    })
    .run();
  const [started] = startBuilds(deps(), {
    projectId: H.projectId,
    todoIds: [todoId],
  });
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
  return { todoId, buildId: started!.id, stepRow };
}

function reportLineOf(buildId: string) {
  return H.s.db.select().from(build).where(eq(build.id, buildId)).get()!.reportLine;
}

function reports(threadId?: string) {
  return H.s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((row) => threadId === undefined || row.threadId === threadId)
    .filter((row) => String(row.content).includes('thread-report'))
    .map((row) => ({
      threadId: row.threadId,
      raw: JSON.parse(String(row.content)) as Record<string, unknown>,
      content: threadReportContentSchema.parse(JSON.parse(String(row.content))),
    }));
}

describe('thread_report line hygiene', () => {
  test('bidi overrides and zero-width characters are stripped from the stored line', () => {
    const { buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, '\uFEFFDone\u202E gnp.exe\u200B tested');
    const stored = reportLineOf(buildId);
    expect(stored).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(stored).toBe('Done gnp.exe tested');
  });
});

describe('D65 report line on every thread', () => {
  test.each(['review', 'done', 'failed'] as const)(
    'an unwatched thread reaching %s writes a coordinator report with the session own line',
    (phase) => {
      const { todoId, buildId, stepRow } = startSession();
      recordThreadReportLine(
        deps(),
        stepRow,
        'Export added; 12 tests pass, CSV and JSON verified.',
      );
      if (phase === 'done') setTodoPhase(deps(), todoId, 'review');
      setTodoPhase(deps(), todoId, phase);
      const last = reports().at(-1)!;
      const coordinator = coordinatorThreadRow(deps(), ensureChief(deps(), H.teamId));
      expect(last.threadId).toBe(coordinator.id);
      expect(last.content.phase).toBe(phase);
      expect(last.content.todoId).toBe(todoId);
      expect(last.content.line).toBe('Export added; 12 tests pass, CSV and JSON verified.');
      expect(reportLineOf(buildId)).toBe('Export added; 12 tests pass, CSV and JSON verified.');
    },
  );

  test('a thread whose session wrote no line reports without a line key', () => {
    const { todoId } = startSession();
    setTodoPhase(deps(), todoId, 'review');
    const last = reports().at(-1)!;
    expect(last.content.phase).toBe('review');
    expect('line' in last.raw).toBe(false);
  });

  test('a watched thread gets its report row with the line and the coordinator gets none', () => {
    const { todoId, stepRow } = startSession();
    const chiefRow = ensureChief(deps(), H.teamId);
    H.s.db
      .update(chief)
      .set({
        watches: [
          {
            todoId,
            projectId: H.projectId,
            seqNum: 3,
            title: 'Export the board',
            projectName: 'p',
            phase: 'building',
            reason: 'dispatch',
            createdAt: 1,
            threadId: H.threadId,
            threadTitle: 't',
          },
        ],
      })
      .where(eq(chief.id, chiefRow.id))
      .run();
    recordThreadReportLine(deps(), stepRow, 'Done on my side.');
    setTodoPhase(deps(), todoId, 'review');
    const rows = reports();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.threadId).toBe(H.threadId);
    expect(rows[0]!.content.line).toBe('Done on my side.');
  });
});

describe('recordThreadReportLine', () => {
  test('a line over the cap or an empty line is rejected and stores nothing', () => {
    const { buildId, stepRow } = startSession();
    expect(() =>
      recordThreadReportLine(deps(), stepRow, 'x'.repeat(THREAD_REPORT_LINE_MAX + 1)),
    ).toThrow(/200/);
    expect(() => recordThreadReportLine(deps(), stepRow, '   ')).toThrow();
    expect(() => recordThreadReportLine(deps(), stepRow, 42)).toThrow();
    expect(reportLineOf(buildId)).toBeNull();
  });

  test('a line at exactly the cap is stored', () => {
    const { buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, 'y'.repeat(THREAD_REPORT_LINE_MAX));
    expect(reportLineOf(buildId)).toHaveLength(THREAD_REPORT_LINE_MAX);
  });

  test('whitespace and control characters collapse before the cap is applied', () => {
    const { buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, `a\n\n  b\u0007\tc${' '.repeat(300)}d`);
    expect(reportLineOf(buildId)).toBe('a b c d');
  });

  test('the stored line always satisfies the report schema', () => {
    const { todoId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, `${'word '.repeat(39)}end\u0000\u001b`);
    setTodoPhase(deps(), todoId, 'review');
    expect(reports().at(-1)!.content.line!.length).toBeLessThanOrEqual(THREAD_REPORT_LINE_MAX);
  });
});

describe('the report line does not go stale across rounds', () => {
  test('a user continuation at review clears the previous line', async () => {
    const { todoId, buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, 'First round summary.');
    H.s.db
      .update(step)
      .set({ status: 'done', sessionId: 'sess-1' })
      .where(eq(step.id, stepRow.id))
      .run();
    setTodoPhase(deps(), todoId, 'review');
    await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Also cover the empty board',
      clientMessageId: 'c-1',
    });
    expect(reportLineOf(buildId)).toBeNull();
    setTodoPhase(deps(), todoId, 'building');
    setTodoPhase(deps(), todoId, 'review');
    const last = reports().at(-1)!;
    expect(last.content.phase).toBe('review');
    expect('line' in last.raw).toBe(false);
  });

  test('a rework from review clears the previous line', async () => {
    const { todoId, buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, 'First round summary.');
    H.s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    setTodoPhase(deps(), todoId, 'review');
    await applyBuildStepAction(
      deps(),
      buildId,
      {
        action: 'revision',
        side: 'plan',
        feedback: 'Cover the empty board',
        clientMessageId: 'c-rework',
      },
      'reviewer',
    );
    expect(reportLineOf(buildId)).toBeNull();
  });

  test('a restart that reuses the build clears the previous line', async () => {
    const { todoId, buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, 'Gave up on the first try.');
    H.s.db
      .update(step)
      .set({ status: 'failed', checkpointCommit: 'abc123' })
      .where(eq(step.id, stepRow.id))
      .run();
    setTodoPhase(deps(), todoId, 'failed');
    await applyBuildStepAction(
      deps(),
      buildId,
      { action: 'restart', feedback: 'try again', clientMessageId: 'c-restart' },
      'reviewer',
    );
    expect(reportLineOf(buildId)).toBeNull();
  });

  test('a restart on a fresh build starts without a line', async () => {
    const { todoId, buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, 'Gave up on the first try.');
    H.s.db.update(step).set({ status: 'failed' }).where(eq(step.id, stepRow.id)).run();
    setTodoPhase(deps(), todoId, 'failed');
    await applyBuildStepAction(
      deps(),
      buildId,
      { action: 'restart', feedback: 'try again', clientMessageId: 'c-restart' },
      'reviewer',
    );
    const latest = H.s.db.select().from(todo).where(eq(todo.id, todoId)).get()!.latestBuildId!;
    expect(reportLineOf(latest)).toBeNull();
  });

  test('a new round that writes its own line replaces the old one', async () => {
    const { todoId, buildId, stepRow } = startSession();
    recordThreadReportLine(deps(), stepRow, 'First round summary.');
    H.s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    setTodoPhase(deps(), todoId, 'review');
    await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Please rename the export',
      clientMessageId: 'c-2',
    });
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((r) => r.status === 'pending')!;
    recordThreadReportLine(deps(), next, 'Second round summary.');
    expect(reportLineOf(buildId)).toBe('Second round summary.');
  });
});

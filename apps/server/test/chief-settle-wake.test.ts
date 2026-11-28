import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { addChiefWatch, triggerChiefWakes } from '../src/services/chief.js';
import { getTodo } from '../src/services/todos.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

function deps() {
  return { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user };
}

function seedWatchedTodo(): string {
  const id = newRecordId();
  H.s.db
    .insert(todoTable)
    .values({
      id,
      teamId: H.teamId,
      projectId: H.projectId,
      title: '给周报补一页 Q3 复盘',
      spec: '',
      phase: 'todo',
      phaseAt: nowMs(),
      seqNum: 1,
      orderIndex: 0,
      latestBuildId: null,
      lastRunAt: null,
      hasChanges: false,
      hasPlan: false,
      sourceTodo: null,
      v: 1,
      createdBy: null,
      ownerId: H.userId,
      sourceBuildId: null,
    })
    .run();
  return id;
}

describe('the settle wake asks for a short human result, not a work log', () => {
  test('settle prompt asks for a short result and grounded availability', () => {
    const todoId = seedWatchedTodo();
    const record = getTodo(deps(), todoId)!;
    addChiefWatch(deps(), {
      teamId: H.teamId,
      todo: record,
      projectName: 'demo',
      threadId: H.threadId,
    });
    triggerChiefWakes(deps(), record, 'done');
    const prompt = String(
      H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all().at(-1)?.prompt,
    );
    expect(prompt).toContain('[wake:settle]');
    expect(prompt).toContain(`provenance=watch:${todoId}`);
    expect(prompt).toContain('1–2 句');
    expect(prompt).toContain('先说结果');
    expect(prompt).not.toContain('2–4 行');
    expect(prompt).toContain('不写文件名、分支、commit、测试数量');
    expect(prompt).toContain('done 本身不代表分支或 PR 已合并');
    expect(prompt).toContain('交付事实没说清的就说不确定');
  });
});

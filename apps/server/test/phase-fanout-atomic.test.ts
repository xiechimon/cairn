import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { chiefMessage, step, todo } from '../src/db/schema.js';
import { addChiefWatch } from '../src/services/chief.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { H, ownerTodo, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

async function seedWatchedBuildingTask() {
  const record = (await relay('create_todo', ownerTodo('Repair board counts'))) as { id: string };
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, record.id)).run();
  const deps = {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
  addChiefWatch(deps, {
    teamId: H.teamId,
    todo: getTodo(deps, record.id)!,
    projectName: 'demo',
    threadId: H.threadId,
  });
  return { deps, todoId: record.id };
}

function phaseOf(todoId: string) {
  return H.s.db.select().from(todo).where(eq(todo.id, todoId)).get()?.phase;
}

function reports() {
  return H.s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((row) => String(row.content).includes('thread-report'));
}

function chiefSteps() {
  return H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).all();
}

describe('a phase change commits together with its Coordinator fan-out', () => {
  test('a failure after the report row leaves the phase, the report and the wake step untouched', async () => {
    const { deps, todoId } = await seedWatchedBuildingTask();
    vi.spyOn(H.s.convHub, 'publishMessage').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    expect(() => setTodoPhase(deps, todoId, 'done')).toThrow('killed between decision and act');
    expect(phaseOf(todoId)).toBe('building');
    expect(reports()).toHaveLength(0);
    expect(chiefSteps()).toHaveLength(0);
  });

  test('the retry after that failure fans out once', async () => {
    const { deps, todoId } = await seedWatchedBuildingTask();
    vi.spyOn(H.s.convHub, 'publishMessage').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    expect(() => setTodoPhase(deps, todoId, 'done')).toThrow();
    setTodoPhase(deps, todoId, 'done');
    setTodoPhase(deps, todoId, 'done');
    expect(phaseOf(todoId)).toBe('done');
    expect(reports()).toHaveLength(1);
    expect(chiefSteps()).toHaveLength(1);
  });
});

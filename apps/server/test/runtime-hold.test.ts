import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  machine as machineTable,
  message,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { applyBuildStepAction, applyStepFailure, type BuildDeps } from '../src/services/builds.js';
import { type MachineDeps, markPresence } from '../src/services/machines.js';
import { sweepFailedRetries } from '../src/services/needs-you.js';
import { resumeRuntimeHeldBuilds } from '../src/services/runtime-holds.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo } from '../src/services/todos.js';
import { bootServer, insertMachine, seedSessionRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposables) dispose();
});

const OUTDATED_CLI =
  'API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required';
const UPDATED_CLI = '2.1.330';
const OUTDATED_CLI_VERSION = '2.1.278';

const claudeReport = (version: string | null) => ({
  installed: true,
  hostname: 'test-host',
  models: [],
  bin: { path: '/bundled/claude', version },
});

interface World {
  s: TestServer;
  deps: BuildDeps;
  machineDeps: MachineDeps;
  machineId: string;
  projectId: string;
  todoId: string;
  buildId: string;
  stepId: string;
}

function openWorld(): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  seedSessionRoute(s);
  const machineId = insertMachine(s);
  const suffix = newRecordId(8);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = newUuidv7();
  const stepId = newRecordId();
  s.db
    .insert(projectTable)
    .values({ id: projectId, name: `runtime-hold-${suffix}`, teamId: s.team.id })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: `Task ${suffix}`,
      spec: 'Do the work.',
      phase: 'building',
      phaseAt: nowMs(),
      seqNum: 1,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: nowMs() - 60_000,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'session',
      status: 'claimed',
      createdAt: nowMs() - 30_000,
    })
    .run();
  const deps: BuildDeps = { ...s.svc, reposDir: s.reposDir, box: s.secretBox };
  const machineDeps: MachineDeps = {
    ...s.svc,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    box: s.secretBox,
  };
  return { s, deps, machineDeps, machineId, projectId, todoId, buildId, stepId };
}

function phaseOf(w: World): string {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.phase ?? '';
}

function buildCount(w: World): number {
  return w.s.db.select().from(buildTable).where(eq(buildTable.todoId, w.todoId)).all().length;
}

function latestBuild(w: World) {
  const latestId = w.s.db
    .select()
    .from(todoTable)
    .where(eq(todoTable.id, w.todoId))
    .get()?.latestBuildId;
  return w.s.db
    .select()
    .from(buildTable)
    .where(eq(buildTable.id, latestId ?? ''))
    .get();
}

function failStep(w: World, stepId: string, error: string): void {
  const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
  if (row === undefined) throw new Error(`missing step ${stepId}`);
  applyStepFailure(w.deps, row, error);
}

function pendingStep(w: World, buildId: string) {
  const row = w.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, buildId))
    .all()
    .find((s) => s.status === 'pending');
  return row;
}

describe('runtime-outdated hold', () => {
  test('a runtime-too-old failure holds without spending the retry budget and resumes on a satisfying report', async () => {
    const w = openWorld();
    failStep(w, w.stepId, OUTDATED_CLI);
    expect(phaseOf(w)).toBe('failed');
    const held = latestBuild(w);
    expect(held?.errorMessage).toContain('Task parked');
    expect(held?.errorMessage).toContain("Cairn's built-in");
    expect(held?.errorMessage).toContain('Update Cairn');
    expect(held?.retryAttempt).toBe(0);

    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);

    markPresence(w.machineDeps, w.machineId, { claudeCode: claudeReport(OUTDATED_CLI_VERSION) });
    await resumeRuntimeHeldBuilds(w.deps, w.s.team.id);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);

    markPresence(w.machineDeps, w.machineId, { claudeCode: claudeReport(UPDATED_CLI) });
    await resumeRuntimeHeldBuilds(w.deps, w.s.team.id);
    expect(phaseOf(w)).toBe('queued');
    const resumed = latestBuild(w);
    expect(resumed?.id).not.toBe(w.buildId);
    expect(resumed?.retryAttempt).toBe(0);
    expect(resumed?.triggerSource).toBe('retry');
    expect(pendingStep(w, resumed?.id ?? '')).toBeDefined();
    expect(
      w.s.db
        .select()
        .from(message)
        .where(eq(message.conversationId, resumed?.id ?? ''))
        .all()
        .some((m) => String(m.content).includes('Resumed automatically')),
    ).toBe(true);
  });

  test('an online installed machine still on the old version keeps the hold parked until it also updates', async () => {
    const w = openWorld();
    insertMachine(w.s, { name: 'stale', claudeCodeReport: claudeReport(OUTDATED_CLI_VERSION) });
    failStep(w, w.stepId, OUTDATED_CLI);

    markPresence(w.machineDeps, w.machineId, { claudeCode: claudeReport(UPDATED_CLI) });
    await resumeRuntimeHeldBuilds(w.deps, w.s.team.id);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);

    const staleMachine = w.s.db
      .select({ id: machineTable.id })
      .from(machineTable)
      .all()
      .find((row) => row.id !== w.machineId);
    markPresence(w.machineDeps, staleMachine?.id ?? '', {
      claudeCode: claudeReport(UPDATED_CLI),
    });
    await resumeRuntimeHeldBuilds(w.deps, w.s.team.id);
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(0);
  });

  test('a legacy retries-exhausted park whose last error is the runtime rejection resumes the same way', async () => {
    const w = openWorld();
    failStep(w, w.stepId, 'connection reset by peer');
    w.s.db
      .update(buildTable)
      .set({
        errorMessage: `Task parked: automatic retries exhausted (3). Last error: ${OUTDATED_CLI}`,
        retryAttempt: 3,
      })
      .where(eq(buildTable.id, w.buildId))
      .run();

    markPresence(w.machineDeps, w.machineId, { claudeCode: claudeReport(UPDATED_CLI) });
    await resumeRuntimeHeldBuilds(w.deps, w.s.team.id);
    expect(phaseOf(w)).toBe('queued');
    const resumed = latestBuild(w);
    expect(resumed?.retryAttempt).toBe(0);
    expect(buildCount(w)).toBe(2);
  });

  test('a hold naming a different runtime is not resumed by a claude report', async () => {
    const w = openWorld();
    failStep(
      w,
      w.stepId,
      'API Error: 400 Codex 0.5.0 does not support this model; version 0.6.0 or newer is required',
    );
    expect(latestBuild(w)?.errorMessage).toContain('Task parked');

    markPresence(w.machineDeps, w.machineId, { claudeCode: claudeReport(UPDATED_CLI) });
    await resumeRuntimeHeldBuilds(w.deps, w.s.team.id);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);
  });

  test('a Coordinator message resumes a parked task through the same restart path as a person', async () => {
    const w = openWorld();
    failStep(w, w.stepId, OUTDATED_CLI);
    expect(latestBuild(w)?.errorMessage).toContain('Task parked');

    const result = await messageThreadAsUser(
      w.deps,
      w.s.team.id,
      w.todoId,
      { content: 'Cairn updated; run it again', clientMessageId: 'chief-resume' },
      { origin: 'coordinator', actor: 'Coordinator' },
    );
    expect(result.delivered).toBe('restart');
    expect(phaseOf(w)).toBe('queued');
    const resumed = latestBuild(w);
    expect(resumed?.retryAttempt).toBe(0);
    expect(resumed?.triggerSource).toBe('chief');
  });

  test('a Coordinator resume of a parked build with a checkpoint reuses it after clearing the hold', async () => {
    const w = openWorld();
    w.s.db
      .update(stepTable)
      .set({ checkpointCommit: 'a'.repeat(40) })
      .where(eq(stepTable.id, w.stepId))
      .run();
    failStep(w, w.stepId, OUTDATED_CLI);
    expect(latestBuild(w)?.errorMessage).toContain('Task parked');

    await applyBuildStepAction(
      w.deps,
      w.buildId,
      { action: 'restart', feedback: '', clientMessageId: 'chief-reuse' },
      'Coordinator',
      'coordinator',
    );
    expect(phaseOf(w)).toBe('queued');
    expect(getTodo(w.deps, w.todoId)?.latestBuildId).toBe(w.buildId);
    const reused = latestBuild(w);
    expect(reused?.errorMessage).toBeNull();
    expect(reused?.retryAttempt).toBe(0);
    expect(pendingStep(w, w.buildId)?.byPerson).toBe(false);
  });

  test('the automatic retry origin still refuses a parked build', async () => {
    const w = openWorld();
    failStep(w, w.stepId, OUTDATED_CLI);
    await expect(
      applyBuildStepAction(
        w.deps,
        w.buildId,
        { action: 'restart', feedback: '', clientMessageId: 'sweep' },
        'cairn',
        'retry',
      ),
    ).rejects.toThrow(/parked/i);
    expect(buildCount(w)).toBe(1);
  });
});

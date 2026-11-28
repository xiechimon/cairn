import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startCoordinator } from '../../apps/server/src/coordinator/index.js';
import {
  message as messageTable,
  step as stepTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import { startBuilds } from '../../apps/server/src/services/builds.js';
import { claimStep } from '../../apps/server/src/services/machines.js';
import { activateInServer, deactivateInServer } from './world.js';
import { insertMessageRow } from '../../apps/server/src/services/transcript.js';
import {
  bootServer,
  finishStepForClaim,
  insertMachine,
  req,
  type TestServer,
} from '../../apps/server/test/helpers.js';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { isScorerProtectedPath, runIsolatedCommand } from './lane.js';
import {
  type BrokeredModel,
  createScriptedArm,
  seedBrokeredRoute,
  seedProjects,
  seedStubRoute,
} from './script.js';
import {
  copyAllowedChangesToScorer,
  initBaselineRepo,
  materializeCommitTree,
  overlayCommitFiles,
} from './snapshot.js';
import type { JourneyTask, TurnRecord } from './types.js';

const ACCEPTANCE_BLOCK_PREFIX = 'acceptance-blocked-';

/**
 * What the runner leg does with the step it claimed. `none` is the honest
 * arm; the others are negative controls that must turn the case red although
 * the patch, the claim and the report all look right in isolation.
 */
export type JourneyArm = 'none' | 'nopatch' | 'unsent';

export interface JourneyOptions {
  /** Git checkout that holds the case's parent and fix commits. */
  repoRoot: string;
  arm?: JourneyArm;
  /** Ceiling for one grading command. */
  commandTimeoutMs?: number;
  /** `stub` replays the case script; `brokered` sends its request to the approved model. */
  model?: 'stub' | 'brokered';
  /** Required when `model` is `brokered`. */
  brokered?: BrokeredModel;
}

export interface ChangedFile {
  path: string;
  status: string;
}

function git(repoRoot: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr.trim()}`);
  return res.stdout;
}

export function changedFilesBetween(repoRoot: string, from: string, to: string): ChangedFile[] {
  const raw = git(repoRoot, ['diff', '--name-status', '-z', from, to]);
  const parts = raw.split('\0').filter((part) => part !== '');
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i] ?? '';
    const path = parts[i + 1] ?? '';
    if (status === '' || path === '') continue;
    files.push({ path, status: status.slice(0, 1) });
  }
  return files;
}

function writeBlob(repoRoot: string, sha: string, path: string, destDir: string): void {
  const res = spawnSync('git', ['show', `${sha}:${path}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`git show ${sha}:${path}: ${res.stderr.trim()}`);
  const target = join(destDir, path);
  spawnSync('mkdir', ['-p', join(target, '..')]);
  writeFileSync(target, res.stdout);
}

function applyFixPatch(
  repoRoot: string,
  task: JourneyTask,
  workDir: string,
  hidden: ReadonlySet<string>,
): string[] {
  const files = changedFilesBetween(repoRoot, task.source.parentCommit, task.source.fixCommit);
  const written: string[] = [];
  for (const file of files) {
    if (hidden.has(file.path) || isScorerProtectedPath(file.path)) continue;
    if (file.status === 'D') {
      const target = join(workDir, file.path);
      if (existsSync(target)) unlinkSync(target);
      written.push(file.path);
      continue;
    }
    writeBlob(repoRoot, task.source.fixCommit, file.path, workDir);
    written.push(file.path);
  }
  return written;
}

function workspaceChanges(workDir: string): string[] {
  const committed = spawnSync('git', ['diff', '--name-only', '-z', 'HEAD'], {
    cwd: workDir,
    encoding: 'utf8',
  });
  const dirty = spawnSync('git', ['status', '--porcelain', '-z'], { cwd: workDir, encoding: 'utf8' });
  const names = new Set<string>();
  for (const name of committed.stdout.split('\0')) if (name !== '') names.add(name);
  const entries = dirty.stdout.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const line = entries[i];
    if (line === undefined || line === '') continue;
    if (line.startsWith('R ') || line.startsWith('C ')) i += 1;
    const name = line.slice(3);
    if (name !== '') names.add(name);
  }
  return [...names];
}

export interface JourneyOutcome {
  record: TurnRecord;
  /** Harness diagnostics; never written into a scorecard or shown to a proposer. */
  diagnostics?: string;
}

export async function runJourneyTask(
  task: JourneyTask,
  options: JourneyOptions,
): Promise<JourneyOutcome> {
  const startedAt = Date.now();
  const arm = options.arm ?? 'none';
  const hidden = new Set([...task.source.testFiles, ...task.source.existingTestFiles]);
  const storageDir = makeTestTempDir('eval-journey-');
  const workDir = mkdtempSync(join(tmpdir(), `eval-journey-work-${task.id}-`));
  const scorerDir = mkdtempSync(join(tmpdir(), `eval-journey-scorer-${task.id}-`));
  const record: TurnRecord = { caseId: task.id, kind: 'journey' };
  const journey: NonNullable<TurnRecord['journey']> = {
    routed: false,
    todoId: null,
    todoTitle: null,
    buildId: null,
    stepId: null,
    claimed: false,
    claimedMachine: null,
    delivered: false,
    acceptanceBlocked: false,
    changedFiles: [],
    fileChecks: [],
    commandChecks: [],
  };
  record.journey = journey;
  let s: TestServer | undefined;
  let coordinator: ReturnType<typeof startCoordinator> | undefined;
  let diagnostics: string | undefined;
  try {
    s = bootServer({});
    activateInServer();
    const teamId = s.team.id;
    const machineId = insertMachine(s, { name: 'bench' });
    if (options.model === 'brokered') {
      if (options.brokered === undefined)
        throw new Error('journey: brokered arm needs an approved model endpoint');
      seedBrokeredRoute(s, teamId, options.brokered);
    } else {
      seedStubRoute(s, teamId);
    }
    const projects = await seedProjects(s, task.world.projects);
    const scripted = options.model === 'brokered' ? null : createScriptedArm(task.script, projects);
    coordinator = startCoordinator({
      machine: {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        vapidKeys: s.vapidKeys,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
        convHub: s.convHub,
      },
      storageDir,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      heartbeatMs: 1_000,
      tickMs: 3_600_000,
      stopPollMs: 50,
      ...(scripted === null ? {} : { fixedProviders: scripted.fixedProviders }),
    });
    const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
      content: task.request,
    });
    if (sent.status !== 201) {
      record.incomplete = `thread:${sent.status}`;
      return { record };
    }
    const { thread } = (await sent.json()) as { thread: { id: string } };
    coordinator.wake(thread.id);
    await coordinator.idle();

    const wanted = task.expected.projects?.[0] ?? task.world.projects[0];
    const wantedId = wanted === undefined ? undefined : projects.get(wanted);
    const todos = s.db.select().from(todoTable).all();
    const todo =
      todos.find((row) => row.projectId !== null && row.projectId === wantedId) ?? todos[0];
    if (todo === undefined || todo.projectId === null) {
      record.durationMs = Date.now() - startedAt;
      return { record };
    }
    journey.routed = true;
    journey.todoId = todo.id;
    journey.todoTitle = todo.title;

    const buildId =
      todo.latestBuildId ??
      startBuilds(s.svc, {
        projectId: todo.projectId,
        todoIds: [todo.id],
        triggerSource: 'user',
      })[0]?.id ??
      null;
    if (buildId === null) {
      record.incomplete = 'no build';
      record.durationMs = Date.now() - startedAt;
      return { record };
    }
    journey.buildId = buildId;

    const machineDeps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    const claimed = await claimStep(machineDeps, machineId, teamId, 0, 'http://127.0.0.1');
    if (claimed === null) {
      record.incomplete = 'no step claimed';
      record.durationMs = Date.now() - startedAt;
      return { record };
    }
    const stepId = claimed.step.id;
    journey.stepId = stepId;
    journey.claimed = true;
    journey.claimedMachine = machineId;

    materializeCommitTree(options.repoRoot, task.source.parentCommit, workDir);
    const baseline = initBaselineRepo(workDir);
    const written = arm === 'nopatch' ? [] : applyFixPatch(options.repoRoot, task, workDir, hidden);
    journey.changedFiles = written;
    journey.fileChecks = task.checks.files.map((check) => {
      const path = join(workDir, check.path);
      const ok =
        existsSync(path) &&
        (check.contains === undefined || readFileSync(path, 'utf8').includes(check.contains));
      return { path: check.path, ok };
    });
    const diff = git(workDir, ['diff', '--no-color', baseline]);

    if (arm !== 'unsent') {
      insertMessageRow({ db: s.db, convHub: s.convHub }, buildId, {
        id: `${stepId}-final`,
        role: 'assistant',
        content: `Fixed ${written.join(', ') || '(nothing)'} and ran the checks.`,
        createdAt: Date.now(),
      });
      await finishStepForClaim(machineDeps, machineId, stepId, {
        status: 'success',
        sessionId: `eval-${task.id}`,
        hasChanges: written.length > 0,
        changesDiff: diff,
      });
    }

    const stepRow = s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    const buildMessages = s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    journey.delivered =
      (stepRow?.status ?? '') === 'done' && buildMessages.some((row) => row.role === 'assistant');
    journey.acceptanceBlocked = buildMessages.some((row) =>
      row.id.startsWith(ACCEPTANCE_BLOCK_PREFIX),
    );

    try {
      materializeCommitTree(options.repoRoot, task.source.parentCommit, scorerDir);
      copyAllowedChangesToScorer(
        workDir,
        scorerDir,
        workspaceChanges(workDir),
        hidden,
        isScorerProtectedPath,
      );
      overlayCommitFiles(options.repoRoot, task.source.fixCommit, task.source.testFiles, scorerDir);
    } catch (error) {
      record.incomplete = `grade setup failed: ${error instanceof Error ? error.message : String(error)}`;
      record.durationMs = Date.now() - startedAt;
      return { record };
    }
    const env: Record<string, string | undefined> = {
      ...process.env,
      CAIRN_LOCAL_HEAVY: '1',
      CAIRN_TEST_TEMP_ROOT: scorerDir,
    };
    delete env.NODE_TEST_CONTEXT;
    for (const command of task.checks.commands) {
      const res = await runIsolatedCommand(command, {
        cwd: scorerDir,
        env,
        timeoutMs: options.commandTimeoutMs ?? 120_000,
        maxBufferBytes: 16 * 1024 * 1024,
      });
      const ok = !res.timedOut && res.signal === null && res.error === undefined && res.status === 0;
      journey.commandChecks.push({ command, ok });
      if (!ok)
        diagnostics = `grading ${command} failed: ${[res.stderr, res.stdout]
          .filter(Boolean)
          .join('\n')
          .trim()
          .slice(-2000)}`;
    }
    record.durationMs = Date.now() - startedAt;
    return { record, ...(diagnostics !== undefined ? { diagnostics } : {}) };
  } catch (error) {
    record.incomplete = error instanceof Error ? error.message : String(error);
    record.durationMs = Date.now() - startedAt;
    return { record };
  } finally {
    await coordinator?.close();
    deactivateInServer();
    s?.dispose();
    releaseTestTempDir(storageDir);
    rmSync(workDir, { recursive: true, force: true });
    rmSync(scorerDir, { recursive: true, force: true });
  }
}
